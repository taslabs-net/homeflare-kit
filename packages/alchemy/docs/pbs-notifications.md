# PBS and PVE notifications — targets, matchers, and an Alertmanager webhook

`@homeflare/alchemy/proxmox` declares both halves of the Proxmox notification system:

| family                        | what it is                                          | source                                                                    |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `Pbs.NotificationTarget`      | where PBS sends: `webhook`, `smtp`, `sendmail`      | [pbs-notification-target.ts](../src/proxmox/pbs-notification-target.ts)   |
| `Pbs.NotificationMatcher`     | which PBS notifications go to which targets         | [pbs-notification-matcher.ts](../src/proxmox/pbs-notification-matcher.ts) |
| `Proxmox.NotificationMatcher` | the same on a PVE cluster                           | [notification-matcher.ts](../src/proxmox/notification-matcher.ts)         |
| `Proxmox.NotificationTarget`  | PVE targets (existing; declares no secret)          | [notification-target.ts](../src/proxmox/notification-target.ts)           |
| `alertmanagerAlertBody()`     | a webhook body that posts one Alertmanager v2 alert | [alertmanager-body.ts](../src/proxmox/alertmanager-body.ts)               |

A target that no matcher names receives nothing. Declare both.

## Paging on a failed verify, sync, prune or garbage collection

```ts
import * as Effect from 'effect/Effect';
import {
  PbsNotificationMatcher,
  PbsNotificationTarget,
  alertmanagerAlertBody,
} from '@homeflare/alchemy/proxmox';

const pbs = {
  api: 'https://pbs.example.com:8007/api2/json',
  mount: 'pbs-mount',
  scheme: 'pbs',
} as const;

export const notifications = Effect.gen(function* () {
  const hook = yield* PbsNotificationTarget('alertmanager', {
    target: pbs,
    type: 'webhook',
    name: 'alertmanager',
    method: 'post',
    url: 'https://alertmanager.example.com/api/v2/alerts',
    header: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer {{ secrets.token }}', // template text, not the token
    },
    secret: { token: { fromEnv: 'PBS_ALERTMANAGER_TOKEN' } }, // the token, by variable name
    body: alertmanagerAlertBody(),
  });
  yield* PbsNotificationMatcher('page-on-failure', {
    target: pbs,
    name: 'page-on-failure',
    targets: [hook.name], // the Output, not a string: it orders create and delete
    'match-severity': ['error'],
    'match-field': ['exact:type=gc,prune,sync,verify'],
  });
});
```

Drop the `Authorization` header and the `secret` when Alertmanager takes unauthenticated posts
on a trusted network. The provider layer is `PbsNotificationTargetProvider()` and
`PbsNotificationMatcherProvider()`. `targets: [hook.name]` matters: PBS refuses a matcher that
names a missing target, and refuses to delete a target a matcher still names. The Output gives
Alchemy that ordering; a bare string does not (`pbs-notifications-stack.test.ts`).

⛔ **A datastore in `legacy-sendmail` mode never reaches a matcher.** PBS mails its `notify-user`
directly. `notification-system` is the default, but a datastore created before PBS 3.2 can say
otherwise. Check with `proxmox-backup-manager datastore show <name>`.

⚠️ **A verification job's event `type` is `verify`**, not `verification`. PBS's own event table
says `verification`, and the source (`send_verify_status`) sets `verify`. The other types are
`gc`, `prune`, `sync`, `tape-backup`, `tape-load`, `package-updates`, `acme`, `thresholds` and
`system-mail`. Garbage collection has no `job-id`.

⚠️ **`match-severity: ['warning', 'error']` under the default `mode: 'all'` matches nothing.**
Each item is combined with `mode`. The severities inside one item are OR-ed, so write
`['warning,error']`.

## Write-only values: `{ fromEnv }`

Alchemy stores props and attributes unencrypted, and a `Redacted` value is tagged, not
encrypted. A secret prop would be a secret in the state database. So `secret`, the smtp
`password` and any header value that is a credential are declared as `{ fromEnv: 'NAME' }`.
The deploying process reads the variable at call time.

| what            | in state                                       | how a plan compares it                                                           |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| secret values   | names (PBS returns names only), and a **seal** | seal of what this provider last wrote, checked against the env value             |
| smtp password   | the seal only (PBS returns nothing)            | the same seal                                                                    |
| header values   | names, and a scrypt digest of the live pairs   | digest of the declared values (env-resolved) against the digest of the live ones |
| everything else | the value                                      | by value, like every family here                                                 |

The seal is `scrypt:<salt>:<digest>`, with a random salt per write. It proves "unchanged" and
holds nothing a reader could send to PBS. A guessable secret stays guessable, so use a random
token.

- **A plan without the variables is presence-only.** Names are compared and values are
  `unknown`. `unknown` plans `noop`, never an invented update.
- **A write carries only the stale groups.** A PUT without `secret` or `header` leaves those on
  the server as they are, so a changed comment deploys without the secrets.
- **A write that needs a missing variable fails by name**, before any request is sent.
- **Adoption is free.** A webhook adopted with secrets has no seal. Its values stay unverified
  (presence-only) until the first write that carries them: a create, a changed secret name, or
  a value rotated after that first write.
- **Rotation.** Change the variable's value and plan: the seal no longer matches, and the deploy
  PUTs the secret group alone.

## The body template

`alertmanagerAlertBody()` renders as:

```handlebars
[ { "labels": {
{{#if fields.type}}"job_type": {{json fields.type}},{{/if}}
{{#if fields.job-id}}"job_id": {{json fields.job-id}},{{/if}}
{{#if fields.datastore}}"datastore": {{json fields.datastore}},{{/if}}
{{#if fields.hostname}}"hostname": {{json fields.hostname}},{{/if}}
"severity":
{{json severity}}, "alertname": "PbsNotification", "source": "pbs" }, "annotations": { "summary":
{{json title}}, "description":
{{json message}}, "timestamp": "{{timestamp}}" } } ]
```

Options: `alertname`, `source` and an optional `generatorURL`. Braces and backslashes are refused.

Why it is written this way. Each point is from the proxmox-notify and Alertmanager source, read
2026-09-22:

- **The webhook renderer has no escaping** (`register_escape_fn(no_escape)`). Every value goes
  through `json`, which writes a complete JSON string. A task log with a quote or a newline stays
  valid JSON.
- **`escape` on a missing field fails the whole render**, and the notification is lost.
  `json` on a missing field writes `null`, which is valid JSON but not a label value. So every
  `fields.*` label sits inside `{{#if}}`, and the constant labels close the object. The UI's
  **Test** button sends a notification with no fields at all.
- **The helpers are `json`, `escape` and `url-encode`, and nothing else.** The mail templates'
  `timestamp` and `duration` helpers are not registered for webhooks, so `timestamp` is sent as
  epoch seconds in an annotation.
- **Alertmanager takes an array** (`postableAlerts`). `labels` is required, and every label or
  annotation value must be a string. It drops empty labels.
- **With no `endsAt`, Alertmanager resolves the alert itself** after `resolve_timeout` (5 min by
  default), and PBS never sends a resolve. Treat a "resolved" notification as a timeout, not a
  recovery.
- **`severity` uses PBS's names**: `info`, `notice`, `warning`, `error`, `unknown`.

The template is rendered in `tests/alertmanager-body.test.ts` with handlebars.js set up like
proxmox-notify's renderer. A scratch build of handlebars-rust 5.1.2, the version proxmox-notify
pins, rendered the same GC, verify and test events to valid JSON. The first real notification is
still the check that counts. Press **Test** on the target, then read what Alertmanager received.

## Adopting the built-in `default-matcher`

A matcher is compared as its whole rule: `match-*`, `mode`, `invert-match` and `disable`,
declared or not. Only `comment` is left alone when undeclared. Adopting a built-in means
declaring what it holds. Measured 2026-09-22:

```ts
// PVE 9.2.11: everything to mail-to-root
ProxmoxNotificationMatcher('default-matcher', {
  target: cluster,
  name: 'default-matcher',
  targets: ['mail-to-root'],
});
// PBS 4.2: everything except successful prune jobs
PbsNotificationMatcher('default-matcher', {
  target: pbs,
  name: 'default-matcher',
  targets: ['mail-to-root'],
  'invert-match': true,
  'match-field': ['exact:type=prune'],
  'match-severity': ['info'],
});
```

Both plan `noop` and deploy with no write (`notification-matcher.test.ts`). ⛔ **Deleting a
built-in reverts it to the shipped rule**, and the server reports success. The attributes show
`origin` so you can see which kind you have.

## Privileges

| server | read                                                                | write                                        |
| ------ | ------------------------------------------------------------------- | -------------------------------------------- |
| PBS    | `Sys.Audit` on `/system/notifications`                              | `Sys.Modify` on `/system/notifications`      |
| PVE    | `Mapping.Audit` (or `.Modify` / `.Use`) on `/mapping/notifications` | `Mapping.Modify` on `/mapping/notifications` |

⚠️ A missing read privilege looks like "absent". The plan says `create` and the server answers
that the object already exists. Grant the read before changing anything else.
