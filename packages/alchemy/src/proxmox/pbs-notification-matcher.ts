/**
 * `Pbs.NotificationMatcher` — which Proxmox Backup Server notifications reach which targets.
 *
 * ★ THIS IS WHERE A FAILED VERIFY, SYNC OR GARBAGE COLLECTION BECOMES A PAGE. pbs-verify-job.ts
 *   explains why verification is the only thing that notices rotten chunks; a matcher is what
 *   turns what it notices into a message. Route `match-severity: ['error']` to a webhook target
 *   (pbs-notification-target.ts, docs/pbs-notifications.md) and a failure pages someone.
 *
 * ⛔ A DATASTORE IN `legacy-sendmail` MODE BYPASSES EVERY MATCHER. PBS reads the datastore's
 *   `notification-mode` before it builds anything (src/server/notifications/mod.rs
 *   `lookup_datastore_notify_settings`, read at HEAD 2026-09-22): `legacy-sendmail` mails the
 *   `notify-user` directly and never consults a matcher. The default is `notification-system`
 *   today (pbs-api-types `NotificationMode`), but a datastore created before PBS 3.2 may say
 *   `legacy-sendmail` explicitly. `Pbs.Datastore` deliberately does not declare the mode (see
 *   `notify` in pbs-datastore.ts), so check it by hand before trusting a matcher with a datastore:
 *   `proxmox-backup-manager datastore show <name>`.
 *
 * ⚠️ THE EVENT `type` FOR A VERIFICATION JOB IS `verify`, NOT `verification`. PBS's own
 *   notifications chapter lists `verification` in its event table and `verify` in its example,
 *   and the source settles it: `send_verify_status` sets `("type", "verify")` (same file). A
 *   `match-field: ['exact:type=verification']` rule matches nothing, silently.
 *   Types at HEAD: `gc`, `prune`, `sync`, `verify`, `tape-backup`, `tape-load`,
 *   `package-updates`, `acme`, `thresholds`, `system-mail`. GC carries `datastore` and `hostname`
 *   but NO `job-id`; prune, sync and verify carry all three; the UI's "Test" carries no fields.
 *
 * ★ ADOPTING THE BUILT-IN AS IT IS. MEASURED on PBS 4.2 (2026-09-22, `proxmox-backup-manager
 *   notification matcher show default-matcher`): it routes everything EXCEPT successful prune
 *   jobs to `mail-to-root` — `invert-match` over `exact:type=prune` AND severity `info`:
 *   ```ts
 *   PbsNotificationMatcher('default-matcher', {
 *     target: pbs, name: 'default-matcher', targets: ['mail-to-root'],
 *     'invert-match': true, 'match-field': ['exact:type=prune'], 'match-severity': ['info'],
 *   });
 *   ```
 *
 * ★ WHAT THIS NEEDS, READ OFF THE SERVER'S SCHEMA (generated/pbs.ts source):
 *     read      GET                 Sys.Audit  on /system/notifications
 *     write     POST, PUT, DELETE   Sys.Modify on /system/notifications
 *   ⚠️ NOT A DATASTORE PRIVILEGE. A credential scoped to `/datastore/...` cannot read matchers;
 *     the old client treated that refusal as absent — notification-target.ts describes the
 *     resulting "absent, then already exists" signature.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import {
  type NotificationMatcherAttributes,
  type NotificationMatcherFields,
  matcherCreateForm,
  matcherMatches,
  matcherUpdateForm,
} from './notification-matcher-form.ts';
import type { PveRequirements, WithPbsTarget } from './resource.ts';
import { guardForm } from './constraint-guard.ts';
import {
  createMatcher,
  deleteMatcher,
  readMatcher,
  updateMatcher,
} from './pbs-notification-matcher-distilled.ts';

export interface PbsNotificationMatcherProps extends NotificationMatcherFields, WithPbsTarget {}

export interface PbsNotificationMatcher extends Resource<
  'Pbs.NotificationMatcher',
  PbsNotificationMatcherProps,
  NotificationMatcherAttributes,
  never,
  PveRequirements
> {}

/** ⚠️ No `retain`, for notification-matcher.ts's reason; a built-in REVERTS on delete. */
export const PbsNotificationMatcher = Resource<PbsNotificationMatcher>('Pbs.NotificationMatcher');

type Props = PbsNotificationMatcherProps;
type Attributes = NotificationMatcherAttributes;

const guardCreate = (props: Props, requirePresence: boolean) =>
  guardForm('pbs:POST /config/notifications/matchers', matcherCreateForm(props), requirePresence);
const guardUpdate = (props: Props) =>
  guardForm('pbs:PUT /config/notifications/matchers/{name}', matcherUpdateForm(props), false);

/**
 * SDK-backed lifecycle: read before writing and compare the entire rule so adoption is free.
 * ⛔ A 401, 403, malformed response or failed credential mint must fail the plan. Only the
 *   SDK's typed NotFound means absent; the old factory turned all of these into false creates.
 */
const handlers = {
  /** Built-ins belong to the host; adopting them must stay an explicit declaration. */
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: Props }) => readMatcher(olds),
  diff: ({
    news,
    olds,
    output,
  }: {
    news: Input<Props>;
    olds: Props;
    output: Attributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* guardCreate(news, output === undefined);
      yield* guardUpdate(news);
      if (output === undefined) return undefined;
      if (olds.name !== news.name) return { action: 'replace' } as const;
      const live = yield* readMatcher(news);
      if (live === undefined) {
        yield* guardCreate(news, true);
        return { action: 'update' } as const;
      }
      return { action: matcherMatches(live, news) ? 'noop' : 'update' } as const;
    }),
  reconcile: ({ news }: { news: Props }) =>
    Effect.gen(function* () {
      const live = yield* readMatcher(news);
      yield* guardCreate(news, live === undefined);
      yield* guardUpdate(news);
      if (live === undefined) yield* createMatcher(news, matcherCreateForm(news));
      else if (!matcherMatches(live, news)) yield* updateMatcher(news, matcherUpdateForm(news));
      const after = yield* readMatcher(news);
      if (after === undefined)
        return yield* Effect.fail(
          new Error(
            `config/notifications/matchers/${news.name}: the write returned no error but the matcher is still absent.`,
          ),
        );
      return after;
    }),
  delete: ({ olds }: { olds: Props }) => deleteMatcher(olds),
};

export const PbsNotificationMatcherProvider = () =>
  Provider.effect(
    PbsNotificationMatcher,
    Effect.succeed(PbsNotificationMatcher.Provider.of(handlers)),
  );
