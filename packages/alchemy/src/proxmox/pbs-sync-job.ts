/**
 * `Pbs.SyncJob` — one section of Proxmox Backup Server's `sync.cfg`, declared: a remote datastore's
 * snapshots pulled into a local one on a schedule.
 *
 * ★ IT USES THE SHARED PVE CLIENT, AND THE TYPES STOP THE TWO HOSTS BEING SWAPPED. An earlier
 *   draft imported a `./pbs-client.ts` that never existed, arguing that reusing the PVE machinery
 *   would COMPILE and that this was the danger — a PBS host accepted wherever a PVE one belongs,
 *   every call 401ing, `read` folding that into "absent". The argument was right and the fix is
 *   the discriminant rather than a second client: `scheme` is REQUIRED on a target, so a PBS host
 *   is not assignable to a PVE resource or the reverse, and the mistake is a compile error. See
 *   the ⛔ on `scheme` in credentials.ts.
 *
 * ⛔ THE CREDENTIAL IS A PBS TOKEN AND IT DOES NOT EXIST YET; NO MOUNT NAME IS INVENTED IN THIS
 *   FILE. PBS wants `user@realm!tokenname` plus a UUID secret, issued by PBS — a PVE token is not
 *   one, whatever it is spelled like. MEASURED from this machine on 2026-09-13: the agent's
 *   approle cannot enumerate mounts (`bao secrets list` -> 403) and
 *   `bao token capabilities kv/infra/proxmox/pbs` -> `deny`, so I could not confirm from here what
 *   does or does not exist. What credentials.ts records is that every PBS token on the kv shelf is
 *   READ-ONLY (`Audit`, as `metrics@pve`) and STATIC — too narrow to create a sync job, and
 *   exactly the kind of credential this provider exists to avoid writing with.
 *   ★ SO THE MOUNT IS A `PbsTarget.mount` THE STACK SUPPLIES, and somebody has to build it first:
 *     a dynamic PBS mount with `read` and `provision` roles mirroring `proxmox-c1`. Until it
 *     exists this family can be declared and cannot be deployed. `permission denied` means the
 *     grant is missing — say which mount and role you needed; do not fall back to the shelf token.
 *
 * ⚠️ WHAT IS MEASURED AND WHAT IS NOT. MEASURED on 2026-09-13 from this machine, read-only and
 *   under STRICT TLS (no `-k`; curl reports `ssl_verify_result` 0):
 *   `GET https://pbs.example.com:8007/api2/json/ping` -> HTTP 200 `{"data":{"pong":true}}`. So
 *   the host is real, its certificate validates, and PBS WRAPS ITS ANSWER IN THE SAME `{"data": …}`
 *   ENVELOPE AS PVE — which is what lets the PVE-shaped client body be reused at all.
 *   ⛔ EVERYTHING ELSE BELOW IS DOCUMENTED, FROM PBS'S PUBLISHED API SCHEMA, AND NOT MEASURED — the
 *     field list, the parameter spellings, which of them a PUT accepts, the privileges. Without a
 *     credential every other endpoint answers 401, and PBS answers 401 BEFORE it routes:
 *     `/api2/json/config/nosuchthing` -> 401, not 404 (measured). So the 401 from
 *     `/api2/json/config/sync` is not even evidence that the endpoint exists. THE FIRST PLAN
 *     AGAINST A LIVE PBS IS THE MEASUREMENT. Read it; do not deploy it unseen.
 *   ⚠️ AN ERROR BODY IS NOT WRAPPED: the 401 body is the bare text `authentication failed`, not
 *     JSON. `pve()` checks `response.ok` before it parses, so a `pbs()` copied from it is safe —
 *     provided the check stays in that order.
 *
 * ⚠️ `Proxmox.BackupJob` AND `Pbs.SyncJob` ARE NOT THE SAME FAMILY AND THE NAMES NEARLY COLLIDE.
 *   The first is a PVE vzdump schedule; this is a Proxmox Backup SERVER sync job, on a different
 *   host. The `Pbs.` prefix is what keeps them apart in a plan, so it is not shortened.
 *
 * ★ THE SEAM, SINCE IT IS NOT THE USUAL ONE. This file answers "what a sync job is and what it
 *   costs to declare one": the props, the attributes, the resource. pbs-sync-job-form.ts answers
 *   "how it meets PBS": the coercions, the create and update bodies, and — the part that normally
 *   lives here — `matches`. `matches` went with the wire because it is DOWNSTREAM of the wire:
 *   ha-rule.ts's rule is that only a field a write can actually set may be compared, so every line
 *   of that predicate is an argument about what the PUT accepts. Splitting it from the forms would
 *   have put the claim and its evidence in different files. `Provider.of(handlers)` stays HERE, for
 *   resource.ts's ⛔: it is the one place the handlers are checked against the concrete resource
 *   types, and a cast there would be a lie about whether they match.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { handlers } from './pbs-sync-job-form.ts';
import type { PveRequirements } from './resource.ts';
import type { WithPbsTarget } from './resource.ts';

/**
 * ⚠️ THE PROPS ARE PBS'S OWN PARAMETER NAMES, DASHES INCLUDED, for backup-job.ts's reason: the form
 *   builder is then a copy rather than a translation table, and a translation table is one more
 *   place for a key to be renamed and silently never sent.
 */
export interface SyncJobProps extends WithPbsTarget {
  /**
   * ⛔ PBS'S SECTION ID AND THIS RESOURCE'S KEY, REQUIRED. Unlike a PVE vzdump job PBS does not
   *   autogenerate one — `POST /config/sync` takes `id` — so the backup-job.ts failure of creating
   *   a second job beside the first on every reconcile cannot happen here. It is still required
   *   rather than derived: to adopt a job that exists, declare the id it already has.
   * ⚠️ A PROXMOX SAFE ID — letters, digits, `_`, `.`, `-`, 3 to 32 characters — so there is nothing
   *   in it for `path` below to encode.
   */
  id: string;
  /** The LOCAL datastore the snapshots land in. Required by PBS at create. */
  store: string;
  /** Local namespace, e.g. `tenant/db`. Unset means the root namespace, which PBS spells `''`. */
  ns?: string;
  /**
   * ⛔ A REMOTE BY NAME ONLY. THIS RESOURCE NEVER MODELS THE CREDENTIAL BEHIND IT, and a
   *   `Pbs.Remote` family is OUT OF SCOPE for this package rather than merely unwritten:
   *   `POST /config/remote` requires `password`, and Alchemy persists props and attributes to its
   *   state store UNENCRYPTED (StateEncoding.ts tags Redacted values rather than encrypting them),
   *   which here is the `alchemy` Postgres that a nightly job dumps to a backup guest. A remote's
   *   password in a prop is that password in four places, for months. The only Remote resource that
   *   could exist would refuse `password` the way storage.ts refuses it — as a `never` — and could
   *   therefore never CREATE a remote, which is a resource that cannot do what its name promises.
   *   Create remotes out of band (`proxmox-backup-manager remote create`) and name one here.
   *   ⚠️ The fingerprint is not the problem: a certificate fingerprint is public. The password is.
   * ⚠️ UNSET MEANS A LOCAL SYNC — datastore to datastore on this same PBS — which is a real and
   *   supported mode, not an omission. See `matches`: an unset `remote` is NOT compared, so leaving
   *   it out does not claim a job with a remote is local; it claims nothing at all.
   */
  remote?: string;
  /** The datastore on that remote. Required by PBS at create. */
  'remote-store': string;
  /** Namespace on the remote. Unset means its root namespace. */
  'remote-ns'?: string;
  /**
   * A PBS calendar event — `daily`, `hourly`, `mon..fri 02:30`. Unset means the job runs ONLY when
   * somebody starts it by hand, which is a sync that is not happening; declare one.
   * ⚠️ THIS COMPARES STRINGS, NOT MEANINGS. A calendar event has many equivalent spellings and PBS
   *   stores the one it was handed, so declare the spelling the server echoes back.
   */
  schedule?: string;
  /** Single line only — PBS's comment schema rejects a newline. */
  comment?: string;
  /**
   * ⛔ THIS DELETES SNAPSHOTS. NOT "prunes", NOT "tidies" — DELETES, on a schedule, driven by
   *   ANOTHER SERVER'S STATE. On a PULL job (the default), every backup group in the local `store`
   *   and `ns` that is no longer on the remote is REMOVED LOCALLY the next time the job runs. The
   *   remote decides; this side obeys. Somebody pruning hard on the remote, a remote datastore
   *   restored from an older copy, a remote namespace renamed, or a remote that has simply lost
   *   data — each of those becomes deletion HERE, and the local copy is usually the copy that was
   *   supposed to survive the remote.
   *   ⛔ AND ON A PUSH JOB IT DELETES ON THE REMOTE INSTEAD — same flag, opposite victim. Read
   *     `sync-direction` before reading this one.
   * ⚠️ IT IS COMPARED AND SENT EVEN WHEN UNDECLARED, unlike every other optional field here, and
   *   that is deliberate: undeclared means `false`, so adopting a job somebody had switched this on
   *   for plans as an UPDATE that switches it off — a real edit, and NOT a free one. It is the
   *   direction that does not delete, but a job that was BOUNDING a datastore now grows it, and a
   *   full PBS datastore fails every backup on it. The plan says only "update"; read the live job.
   */
  'remove-vanished'?: boolean;
  /**
   * The PBS Authid that owns the synced groups, e.g. `sync@pbs` or `sync@pbs!job1`. Unset leaves
   * the config without one, which PBS reads as `root@pam` AT RUNTIME — so unset and `root@pam` are
   * not the same value in the config even though they behave alike. Owning a group is what lets an
   * Authid prune or delete it, so changing this is a permissions change, not a label.
   * ⚠️ AN AUTHID IS AN IDENTIFIER, NEVER A SECRET — it may name an API token (`user@realm!name`),
   *   and the token's VALUE is the secret. This resource stores the name and never the value.
   */
  owner?: string;
  /**
   * Incoming rate limit in BYTES PER SECOND. Unset means unlimited.
   * ⚠️ DECLARED IN BYTES, STORED AS A HUMAN STRING. PBS types this as a `HumanByte`, so a written
   *   `10485760` comes back as something like `10.00 MiB`; `bytes()` in the form file parses both
   *   ends back to a byte count so the two can be compared at all. REASONED from the type, NOT
   *   measured — I had no credential to round-trip one.
   * ⛔ DECLARE A VALUE PBS CAN PRINT EXACTLY — a whole multiple of a binary unit. A rate that
   *   rounds in the printed form (10485761) reads back as the rounded value, never equals what was
   *   declared, and becomes an update reported on every plan forever. This is the single most
   *   likely forever-diff in this file; it is the first thing to check on the first plan.
   * ⚠️ `burst-in`, `rate-out` AND `burst-out` ARE NOT MODELLED. PBS's rate limit is four fields
   *   flattened into the job; this resource manages one and leaves the others alone, which is safe
   *   because PBS's update assigns only the parameters it was sent.
   */
  'rate-in'?: number;
  /**
   * How many namespace levels below `remote-ns` to sync, 0 (no recursion) upwards. Unset means PBS
   * recurses as deep as it is allowed — which is MORE data, not less, so it is not a safe default
   * to leave implicit on a job whose target namespace has children.
   */
  'max-depth'?: number;
  /** Sync only the last N snapshots of each group. Unset means all of them. */
  'transfer-last'?: number;
  /**
   * ⛔ NOT DECLARABLE, AND A COMPILE ERROR RATHER THAN A PROP THAT HALF WORKS — the storage.ts
   *   `password` idiom, for two independent reasons, either of which alone would be enough.
   *   1. THE WIRE FORM IS AN ARRAY. PBS takes `group-filter` as a repeated parameter
   *      (`group-filter=type:ct&group-filter=regex:^web`), and `pve()`'s form is
   *      `Record<string, string>` — one value per key — so a list cannot be expressed at all.
   *   2. NARROWING A FILTER MAY BE A DELETE. Whether `remove-vanished` skips the groups a filter
   *      excludes is NOT something I could measure without a credential. If it does not, then
   *      editing this field on a job with `remove-vanished` set removes every local group the new
   *      filter excludes. A field that MIGHT delete snapshots when changed does not get a
   *      half-working prop.
   *   ★ IT IS STILL REPORTED in the attributes, so a plan shows the filters a hand-made job carries
   *     and this resource never strips them: undeclared is unmanaged, and PBS's update assigns only
   *     what it was sent. To make it declarable, fix both halves — a form type that can repeat a
   *     key, and a MEASURED answer to (2) — in that order.
   */
  'group-filter'?: never;
  /**
   * `pull` (default) or `push`. ⛔ IT DECIDES WHICH SIDE `remove-vanished` DELETES FROM. Push also
   * needs a newer PBS: on a server that predates it the parameter is unknown and the create is
   * refused, which is the honest failure.
   * ⚠️ CREATE-ONLY HERE, SO A CHANGED DIRECTION PLANS AS NOOP — see `matches`. That is the
   *   deliberately safe half of an unmeasured question: if PBS does accept it on PUT, the cost of
   *   this choice is a noop; if PBS refuses it, comparing it would be an update the PUT can never
   *   perform, on every plan, forever. Retire the declaration and add another, as user.ts says for
   *   `userid`.
   */
  'sync-direction'?: 'pull' | 'push';
  /**
   * ⚠️ SYNC ONLY SNAPSHOTS THAT HAVE PASSED VERIFICATION. Present on 4.2 (`sync-job update
   *   --verified-only <boolean>`, and in its `--delete` enum), and the estate sets it: the parked
   *   `sync-all-to-dc` job carries `verified-only: true`, so without this prop that job cannot be
   *   declared as it actually is.
   * ⛔ IT PAIRS WITH A VERIFICATION JOB THAT ACTUALLY RUNS. With PBS's defaults a snapshot is
   *   verified once and never again — see `rechecks` in pbs-verify-job-form.ts — so `verified-only`
   *   on a datastore whose verify job is parked means "sync only what was checked once, long ago".
   */
  'verified-only'?: boolean;
}

export interface SyncJobAttributes {
  /** From the props — it is the path this object was read by. */
  id: string;
  store: string;
  /** `''` is the root namespace, which is also how PBS spells it. */
  ns: string;
  /** `''` means a LOCAL sync — datastore to datastore on this PBS. */
  remote: string;
  'remote-store': string;
  'remote-ns': string;
  /** `''` means the job runs only when somebody starts it. */
  schedule: string;
  comment: string;
  'remove-vanished': boolean;
  /** ⚠️ Absent on the wire means `false`, PBS's own default. */
  'verified-only': boolean;
  /** `''` means no owner in the config, i.e. `root@pam` at runtime. An identifier, never a secret. */
  owner: string;
  /** Bytes per second, or `UNSET` (-1). See `bytes()`. */
  'rate-in': number;
  /** `UNSET` (-1) means unset, which means full recursion. `0` is a real value meaning none. */
  'max-depth': number;
  /** `UNSET` (-1) means all snapshots. */
  'transfer-last': number;
  /**
   * ⚠️ REPORTED, NEVER SENT, NEVER COMPARED — the live filter list joined for display only. See the
   *   ⛔ on the prop for why it is not declarable.
   */
  'group-filter': string;
  /** `pull` or `push`. Reported, never compared — create-only here. */
  'sync-direction': string;
}

export interface PbsSyncJob extends Resource<
  'Pbs.SyncJob',
  SyncJobProps,
  SyncJobAttributes,
  never,
  PveRequirements
> {}

/**
 * ⚠️ NO `defaultRemovalPolicy: 'retain'`, and the reasoning is replication-job.ts's. Deleting this
 *   object removes a SCHEDULE, not data: every snapshot already synced stays in the local
 *   datastore, and PBS's own pruning is a different job. What is lost is freshness — which is
 *   destructive in six months rather than today, and is exactly why the plan line deserves reading.
 */
export const PbsSyncJob = Resource<PbsSyncJob>('Pbs.SyncJob');

/**
 * ⛔ THE EMPTY `list` FROM THE FACTORY STANDS. `GET /config/sync` hands back every sync job an
 *   operator ever made in the UI, and adopting one is how a later `alchemy destroy` silently stops
 *   a second copy being refreshed. Adoption is an explicit act — declare the `id` you mean.
 * ⚠️ DELETING THE JOB DOES NOT DELETE SNAPSHOTS, AND `remove-vanished` DOES. Those two sentences
 *   are the whole risk model of this family and they point opposite ways: the DELETE plan line is
 *   safe today and expensive in six months, while a single `remove-vanished: true` is a standing
 *   instruction to delete local snapshots whenever another server loses them.
 */
export const PbsSyncJobProvider = () =>
  Provider.effect(PbsSyncJob, Effect.succeed(PbsSyncJob.Provider.of(handlers)));
