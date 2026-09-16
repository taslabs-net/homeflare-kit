/**
 * A PBS datastore on the wire: the transport that reaches PBS, the form it wants, and the coercion
 * back to something comparable.
 *
 * ★ SPLIT OUT OF pbs-datastore.ts FOR THE 250-LINE CAP, the seam notification-target-form.ts uses:
 *   this file is everything that touches PBS's encoding, and the resource file is the declaration
 *   and the five handlers. The `import type` back is erased, so it is a cycle on paper only.
 *
 * ⛔ THIS FILE IS OVER THE 250-LINE CAP AND THE EXTRACTION IS NAMED RATHER THAN FUDGED. `PbsTarget`,
 *   `PbsRole`, `PbsError`, `pbsAuthorization`, `PveForm`, `encode`, `pbs` and `settle` — about 150
 *   lines — are a PBS CLIENT, not a datastore form, and belong in `pbs-client.ts`. Lifting them
 *   leaves this file near 200 and costs nothing but a move. It was not done here only because the
 *   family was commissioned as a two-file split; ceph-pool is the in-package precedent for three
 *   (ceph-pool.ts + ceph-pool-form.ts + ceph-pool-settle.ts, 532 lines for one family). Everything
 *   in that list is also what Pbs.SyncJob, Pbs.PruneJob and Pbs.Remote will each need unchanged,
 *   so the second PBS family forces the move anyway. ⛔ DO NOT MEET THE CAP BY CUTTING COMMENTS.
 */
import * as Effect from 'effect/Effect';
import { type PveForm, pve } from './client.ts';
import type { PbsTarget as ApiPbsTarget } from './credentials.ts';
import type { PbsDatastoreProps } from './pbs-datastore.ts';
import { bool, flag, int, propertyString, text } from './values.ts';

/**
 * ★ PBS REUSES THE PVE CLIENT RATHER THAN OWNING ONE. An earlier draft of this file carried its
 *   own `PbsTarget`, `PbsError`, `pbsAuthorization`, form encoder and `pve()` — a near-copy of
 *   client.ts differing in one header. They are gone: `PveTarget` now carries a `scheme`, and
 *   `authorization()` spells the header `PBSAPIToken=<id>:<secret>` when it is `'pbs'`. The
 *   insight that survived is the FORM TYPE — PBS decodes a multi-valued field from repeated keys
 *   where PVE wants a comma string — and that now lives on `PveForm` in client.ts, so both
 *   products share one encoder and neither can reach for the other's convention by accident.
 *
 * 🔴 THIS ALIAS SAID `= PveTarget` AND IT WAS WRONG — Pbs.Datastore REQUIRED A PVE TARGET. When
 *   `credentials.ts` grew a real `PbsTarget` with `scheme: 'pbs'`, this line was left pointing at
 *   the PVE type, which pins `scheme: 'pve'`. So the one family that most needs the discriminant
 *   was the one family that refused the correct value: declaring a datastore against the PBS host
 *   failed to compile with `Type '"pbs"' is not assignable to type 'Input<"pve">'`, and passing a
 *   PVE target compiled fine and would have 401'd every call — which `read` folds into "absent",
 *   so the plan would say CREATE for a datastore holding the estate's backups.
 *   ⛔ IT SURVIVED BECAUSE NOTHING EVER DECLARED ONE. The provider was registered in
 *   alchemy.run.ts from the day it was written and `pveHandlers`' `list` answers empty, so
 *   registration exercises no call site at all. Three sibling families import `PbsTarget` from
 *   credentials.ts directly and were always correct; only the one with its own alias drifted.
 *   ★ THE LESSON, WHICH IS NOT ABOUT THIS TYPE: a provider nobody has declared an instance of is
 *   not tested by anything, including tsc.
 */
export type PbsTarget = ApiPbsTarget;

export interface PbsDatastoreAttributes {
  name: string;
  /**
   * ⚠️ READ FROM PBS, NEVER ECHOED FROM PROPS. Echoing the declared path would make a divergent or
   *   unreadable datastore look like agreement, and this is the field whose divergence means the
   *   backups are going somewhere nobody declared. `''` when PBS did not say.
   */
  path: string;
  comment: string;
  'gc-schedule': string;
  'prune-schedule': string;
  'keep-last': number;
  'keep-hourly': number;
  'keep-daily': number;
  'keep-weekly': number;
  'keep-monthly': number;
  'keep-yearly': number;
  /** Normalised property strings — sorted and canonicalised, so key order is never a diff. */
  notify: string;
  'notify-user': string;
  'verify-new': boolean;
  tuning: string;
  'maintenance-mode': string;
  /** ⚠️ Create-only. Canonicalised property string; `''` on a plain local datastore. */
  backend: string;
  'counter-reset-schedule': string;
  'notification-thresholds': string;
}

/**
 * ⚠️ `digest` IS DELIBERATELY NOT AN ATTRIBUTE, for storage.ts's reason exactly: PBS returns one on
 *   every read and it covers `datastore.cfg` as a FILE, not this section of it, so keeping it would
 *   rewrite this resource's state whenever an unrelated datastore was edited — churn that reads
 *   like drift. It is not sent on writes either, so this family never joins PBS's optimistic-locking
 *   dance and last write wins, as everywhere else in this package.
 */
export const attributes = (
  live: Record<string, unknown>,
  props: PbsDatastoreProps,
): PbsDatastoreAttributes => ({
  backend: propertyString(live['backend']),
  comment: text(live['comment']),
  'counter-reset-schedule': text(live['counter-reset-schedule']).trim(),
  'gc-schedule': text(live['gc-schedule']).trim(),
  'keep-daily': int(live['keep-daily'], 0),
  'keep-hourly': int(live['keep-hourly'], 0),
  'keep-last': int(live['keep-last'], 0),
  'keep-monthly': int(live['keep-monthly'], 0),
  'keep-weekly': int(live['keep-weekly'], 0),
  'keep-yearly': int(live['keep-yearly'], 0),
  'maintenance-mode': propertyString(live['maintenance-mode'], 'type'),
  name: props.name,
  'notification-thresholds': propertyString(live['notification-thresholds']),
  notify: propertyString(live['notify']),
  'notify-user': text(live['notify-user']),
  path: text(live['path']),
  'prune-schedule': text(live['prune-schedule']).trim(),
  tuning: propertyString(live['tuning']),
  'verify-new': bool(live['verify-new']),
});

const same = <T>(declared: T | undefined, live: T) => declared === undefined || declared === live;

/**
 * ⛔ DECLARING WHAT IS LIVE MUST PLAN noop, AND EVERY OMISSION IS DELIBERATE. Out: `name` (the
 *   address the read was made at — true by construction, never a diff); `path` (create-only, so
 *   comparing it could only plan an update no PUT can apply — pbs-datastore.ts guards it by dying
 *   instead, see the ⛔ on the prop); `digest` (not an attribute, above); and every field the
 *   declaration does not mention, because undeclared is UNMANAGED here.
 * ⚠️ A SCHEDULE THAT NEVER SETTLES MEANS PBS NORMALISED IT. Calendar events are compared as trimmed
 *   strings; if a version rewrites `sat 18:15` as `Sat 18:15` the plan asks for the same update
 *   forever. The fix is to declare the spelling PBS stores, never to stop comparing it.
 */
export const matches = (live: PbsDatastoreAttributes, props: PbsDatastoreProps) =>
  same(props.comment, live.comment) &&
  same(props['gc-schedule']?.trim(), live['gc-schedule']) &&
  same(props['prune-schedule']?.trim(), live['prune-schedule']) &&
  same(props['keep-last'], live['keep-last']) &&
  same(props['keep-hourly'], live['keep-hourly']) &&
  same(props['keep-daily'], live['keep-daily']) &&
  same(props['keep-weekly'], live['keep-weekly']) &&
  same(props['keep-monthly'], live['keep-monthly']) &&
  same(props['keep-yearly'], live['keep-yearly']) &&
  same(props['notify-user'], live['notify-user']) &&
  same(props['counter-reset-schedule']?.trim(), live['counter-reset-schedule']) &&
  (props['notification-thresholds'] === undefined ||
    propertyString(props['notification-thresholds']) === live['notification-thresholds']) &&
  same(props['verify-new'], live['verify-new']) &&
  (props.notify === undefined || propertyString(props.notify) === live.notify) &&
  (props.tuning === undefined || propertyString(props.tuning) === live.tuning) &&
  (props['maintenance-mode'] === undefined ||
    propertyString(props['maintenance-mode'], 'type') === live['maintenance-mode']);

const set = (key: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [key]: value };

/** ⚠️ PBS's minimum for every keep-* is 1, so a declared `0` is refused rather than meaning "off". */
const count = (value: number | undefined) => (value === undefined ? undefined : String(value));

/**
 * The mutable half, shared by create and update.
 *
 * ⚠️ AN UNDECLARED FIELD IS NOT SENT — storage.ts's rule. PBS leaves a parameter it was not given
 *   alone, so this form is safe to re-apply to a datastore that already matches, which is what the
 *   adoption path does.
 * ⛔ `name` AND `path` ARE ABSENT ON PURPOSE. Both are create-only: `name` is the address forever
 *   after, and PBS's update endpoint does not accept `path` at all, so including it here would turn
 *   every single update into a 400.
 */
const mutable = (props: PbsDatastoreProps): Record<string, string> => ({
  ...set('comment', props.comment),
  ...set('gc-schedule', props['gc-schedule']?.trim()),
  ...set('keep-daily', count(props['keep-daily'])),
  ...set('keep-hourly', count(props['keep-hourly'])),
  ...set('keep-last', count(props['keep-last'])),
  ...set('keep-monthly', count(props['keep-monthly'])),
  ...set('keep-weekly', count(props['keep-weekly'])),
  ...set('keep-yearly', count(props['keep-yearly'])),
  ...set('counter-reset-schedule', props['counter-reset-schedule']),
  ...set('maintenance-mode', props['maintenance-mode']),
  ...set('notification-thresholds', props['notification-thresholds']),
  ...set('notify', props.notify),
  ...set('notify-user', props['notify-user']),
  ...set('prune-schedule', props['prune-schedule']?.trim()),
  ...set('tuning', props.tuning),
  ...set('verify-new', flag(props['verify-new'])),
});

/**
 * ⚠️ `path` IS SENT ONCE, HERE, AND NEVER AGAIN — the fact the whole `path` guard hangs off.
 * ⚠️ `reuse-datastore` IS NOT SENT, AND THE REFUSAL IT CAUSES IS A FEATURE: without it PBS refuses
 *   a create against a directory that already holds a chunk store, which is the difference between
 *   building a new store and silently adopting somebody else's backups. Adopt out of band.
 * ⚠️ NEITHER IS `backing-device`. A removable datastore's UUID is a property of the hardware in the
 *   slot, not of the declaration; one that could re-point it is one that can send backups to the
 *   wrong drive.
 */
export const createForm = (props: PbsDatastoreProps): PveForm => ({
  ...mutable(props),
  name: props.name,
  path: props.path,
  // ⛔ CREATE ONLY, AND ABSENT FROM `mutable` ON PURPOSE. PBS has no `--backend` on update and no
  //   `backend` in update's `--delete` enum (measured on 4.2), so sending it on a PUT is a
  //   parameter error at best. Divergence is caught by guardBackend, which DIES — the same shape
  //   as `path`, for a bigger consequence.
  ...(props.backend === undefined ? {} : { backend: props.backend }),
});

/**
 * ⛔ THERE IS NO `delete` LIST HERE, AND THAT IS A CHOICE ABOUT BACKUPS RATHER THAN AN OMISSION.
 *   sdn-vnet.ts derives one from absent props, which is right for an alias and wrong for a
 *   retention policy: a declaration that simply fails to mention `keep-daily` would strip it, and a
 *   prune job whose keeps have all been stripped is one PBS version away from a prune job that
 *   keeps nothing. So undeclared is UNMANAGED, as in storage.ts and backup-job.ts.
 *   ⚠️ THE PRICE IS THAT DROPPING A LINE DOES NOT CLEAR A FIELD. Clear one out of band:
 *     `proxmox-backup-manager datastore update <name> --delete keep-daily`. It does not cost a
 *     forever-diff, because an undeclared field is not compared either.
 *   ⛔ WHEN SOMEBODY ADDS ONE, IT TAKES TWO STEPS AND SKIPPING EITHER IS A SILENT BUG. First build
 *     it with `values.withClears`, which drops a cleared key from the body — CLEAR WINS — because
 *     PBS applies its deletes BEFORE its sets, so a key both set and deleted keeps its value: the
 *     declaration would say "unset this", the PUT would succeed, and the next plan would ask for
 *     the very same update forever. (PVE instead DIES on that pair; the two behaviours want the
 *     same guard.) Second, split the comma-joined value `withClears` produces into a real array —
 *     PBS's `delete` is `type: array` and wants REPEATED KEYS, and a comma string arrives as one
 *     element that fails the enum check. `PveForm` and `encode` already carry arrays for exactly
 *     this. ⚠️ REASONED FROM THE PUBLISHED SCHEMA, NOT PROVEN ON A WIRE.
 */
export const updateForm = (props: PbsDatastoreProps): PveForm => mutable(props);

export const object = (props: PbsDatastoreProps) => `config/datastore/${props.name}`;

/**
 * The live datastore, or undefined.
 *
 * ⛔ `name` IS THE PRESENCE TEST, NOT THE STATUS CODE — PBS does not answer 404 for a section that
 *   is missing from `datastore.cfg`, it answers a generic error, so there is no code to key off.
 * ⛔ A MISSING READ PRIVILEGE THEREFORE LOOKS EXACTLY LIKE ABSENCE, because the fold below cannot
 *   tell them apart. The signature is a plan that says CREATE followed by PBS answering
 *   "datastore '<name>' already exists." — that pair means Datastore.Audit, not a missing
 *   datastore. It is loud and non-destructive, which is the only reason the fold is tolerable here;
 *   see the ⛔ on `readRole` in resource.ts for the PVE families where it is not.
 * ⛔ ON THE DELETE PATH THE SAME FOLD IS A LIE, AND THIS IS THE ONE HAZARD IN THIS FAMILY I COULD
 *   NOT CLOSE. `delete` settles by polling this read until it answers `undefined` — and a `read`
 *   role that lacks `Datastore.Audit` answers `undefined` from the very first poll, so EVERY delete
 *   would report success while the datastore stood. Worse, the two lanes are different leases: the
 *   DELETE goes out under `provision` and may genuinely fail, and this read cannot see that it did.
 *   ★ THE SHAPE OF THE FIX IS ALREADY IN THIS PACKAGE: `confirmAbsent` in ceph-pool-settle.ts asks
 *     a SECOND, DIFFERENT question — does the collection LIST this object? — and lets a failure
 *     PROPAGATE rather than folding it, so "I could not ask" fails the deploy instead of passing
 *     it. Add the same over `GET /config/datastore` before anyone relies on a reported deletion.
 *   ⚠️ UNTIL THEN THE PRECONDITION IS EXPLICIT: the `read` role MUST hold `Datastore.Audit` on the
 *     datastore, or this provider cannot tell a deletion from a refusal.
 */
export const readOne = (props: PbsDatastoreProps) =>
  pve<Record<string, unknown>>(props.target, 'read', 'GET', object(props)).pipe(
    Effect.map((live) =>
      live === undefined || typeof live['name'] !== 'string' ? undefined : attributes(live, props),
    ),
    Effect.orElseSucceed(() => undefined),
  );
