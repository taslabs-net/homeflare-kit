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
 *   ⚠️ NOT A DATASTORE PRIVILEGE. A PBS credential scoped to `/datastore/...` reads every matcher
 *     as absent — the "absent, then already exists" signature notification-target.ts describes.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import {
  type NotificationMatcherAttributes,
  type NotificationMatcherFields,
  matcherAttributes,
  matcherCreateForm,
  matcherMatches,
  matcherUpdateForm,
} from './notification-matcher-form.ts';
import { type PveRequirements, type WithPbsTarget, pveHandlers } from './resource.ts';

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

const handlers = pveHandlers<PbsNotificationMatcherProps, NotificationMatcherAttributes>({
  attributes: (live, props) => matcherAttributes(live, props.name),
  collection: () => 'config/notifications/matchers',
  createForm: matcherCreateForm,
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: {
    create: 'pbs:POST /config/notifications/matchers',
    update: 'pbs:PUT /config/notifications/matchers/{name}',
  },
  matches: matcherMatches,
  path: (props) => `config/notifications/matchers/${props.name}`,
  updateForm: matcherUpdateForm,
});

export const PbsNotificationMatcherProvider = () =>
  Provider.effect(
    PbsNotificationMatcher,
    Effect.succeed(PbsNotificationMatcher.Provider.of(handlers)),
  );
