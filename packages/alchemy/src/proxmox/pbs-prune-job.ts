/**
 * `Pbs.PruneJob` — a Proxmox Backup Server retention schedule, declared. PBS is a SIBLING of PVE,
 * so this family reuses `pveHandlers` wholesale rather than growing a second factory.
 *
 * ⛔ THIS IS THE ONE RESOURCE IN THIS PACKAGE THAT DESTROYS DATA ON AN ORDINARY *UPDATE*. CephPool,
 *   ZfsPool and Storage can destroy data too — which is exactly why they default to `retain` and
 *   make a caller opt in with `destroy()`, and that guard covers DELETE and nothing else. Here the
 *   destruction rides a plain `1 to update` that no removal policy has any opinion about. A wrong
 *   `keep-*` does not fail: it succeeds. The PUT returns 200, and the NEXT SCHEDULED RUN — minutes
 *   or days later, with nobody watching — removes every snapshot that fell outside the new window.
 *   There is no undo, PBS does not ask, and nothing about the deploy looks unusual.
 *   ★ CONCRETELY, SO NOBODY HAS TO IMAGINE IT: a live job with `keep-daily 30`, a declaration
 *     saying `keep-daily: 7`. `matches` reports an update, the PUT lands, and twenty-three days of
 *     daily backups are gone at the next run. The plan showed one word. READ THE `keep-*` HALF OF
 *     EVERY PLAN TWICE; it is the only warning there is.
 *   ⚠️ THE ONE THING THAT CANNOT HAPPEN IS A SILENT ZERO. MEASURED from the published schema: every
 *     `keep-*` carries `minimum: 1`, so a literal `keep-daily=0` is a 400 rather than a wipe. And
 *     an UNDECLARED window is not sent as zero either — it is not sent at all, because undeclared
 *     means unmanaged here exactly as it does in storage.ts. A window this stack never named is one
 *     it never narrows. `0` in the attributes below therefore means ABSENT, never a real setting.
 *
 * ⛔ `max-depth` UNSET IS THE WIDEST SCOPE, NOT THE NARROWEST, AND IT IS THE ONE FIELD WHERE
 *   "UNMANAGED" IS NOT THE SAFE ANSWER. MEASURED, quoting the published schema's own description:
 *   "0 == no recursion, empty == automatic full recursion". So a job that names an `ns` but leaves
 *   `max-depth` alone prunes every namespace BENEATH that one too, with these windows. Declare it.
 *   `-1` in the attributes means "absent from prune.cfg", the sentinel storage.ts uses for
 *   `maxfiles`, because `0` here is a real and very different setting.
 *
 * ⛔ THE CREDENTIAL DOES NOT EXIST YET, SO NOTHING BELOW HAS EVER MADE A CALL. PBS is a different
 *   host and a different auth realm from PVE. MEASURED 2026-09-13: pbs.example.com:8007 answers
 *   HTTP 401 under STRICT TLS behind a real Let's Encrypt certificate (CN=pbs.example.com, issuer
 *   YR1, valid 2026-09-02 to 2026-12-01) — so there is no `-k` to reach for and `client.ts` needs
 *   no TLS escape hatch, exactly as on PVE. What it does need is a header it cannot build today.
 *   PBS's documented form is `Authorization: PBSAPIToken=TOKENID:TOKENSECRET` (measured from the
 *   published PBS documentation, 2026-09-13) while `authorization()` in credentials.ts builds
 *   `PVEAPIToken=<tokenid>=<secret>`: BOTH the scheme and the separator differ. A wrong separator
 *   answers 401 "authentication failure", which reads as a bad credential rather than as a
 *   malformed header — the same trap credentials.ts already records for PVE's colon form.
 *   ⛔ AND THERE IS NO MOUNT TO MINT FROM. `mint()` runs `bao read <mount>/creds/<role>`; no
 *     OpenBao mount vends PBS tokens — `proxmox-c1` and `proxmox-c2` vend PVE ones. The
 *     `kv/infra/proxmox` shelf holds a READ-ONLY `Audit` token for PBS, and a read-only token
 *     cannot create a prune job. I could not confirm that shelf's contents: this machine's
 *     agent approle answers 403 on `sys/mounts` AND on `kv/metadata/infra/proxmox`
 *     (MEASURED). What is needed is a dynamic PBS mount vending a `provision` role with
 *     `Datastore.Modify` — say that, rather than reaching for the stored auditor token.
 *
 * ★ WHAT A `PbsTarget` NEEDS, AND WHY IT IS ALMOST `PveTarget`. Structurally `PveTarget` already
 *   fits a PBS host: a credential mount name and an `/api2/json` base are the whole of it, and PBS
 *   shares the `{"data": …}` envelope, the four-operation shape and the read-back discipline —
 *   which is exactly why this file declares a spec and stops. The single thing `PveTarget` cannot
 *   carry is WHICH AUTHORIZATION SCHEME the host at the other end speaks, so `PbsTarget` below adds
 *   that and nothing else rather than bending the PVE type in silence.
 *
 * ⚠️ WHICH VERSION THIS IS AUTHORED AGAINST, BECAUSE PRUNE JOBS MOVED. The paths and every field
 *   below are MEASURED from the PBS API as published at pbs.proxmox.com/docs/api-viewer, fetched
 *   2026-09-13 — current PBS 4.x. Before PBS 2.2 there was no `/config/prune` at all: retention
 *   lived on the datastore section itself, as `keep-*` plus `prune-schedule` under
 *   `/config/datastore/{name}`. Against anything older every path here 404s, `pveOperations.read`
 *   folds that into "absent", and the plan says create forever. Check `GET /api2/json/version`
 *   before the first plan.
 *
 * ★ THE READ LANE NEEDS NOTHING EXTRA, UNLIKE THREE PVE FAMILIES — so there is no `readRole:
 *   'provision'` below and there should not be one. MEASURED: `GET /config/prune/{id}` requires
 *   "Datastore.Audit or Datastore.Verify on job's datastore", i.e. the AUDIT privilege is enough
 *   for the ITEM read. That is precisely what `Proxmox.Storage` and the two SDN families could not
 *   say, and it is why the ⛔ on `readRole` in resource.ts does not claim a fourth family here.
 *   ⚠️ THE WRITE PRIVILEGES ARE NOT ONE PRIVILEGE, AND DELETE IS THE ODD ONE OUT. MEASURED: POST
 *     and PUT require `Datastore.Modify` on the job's datastore; DELETE requires `Datastore.Verify`.
 *     A credential that can create and edit a prune job cannot necessarily remove one, and the
 *     symptom is a destroy that 403s long after the creates worked.
 *
 * ⚠️ RUNTIME STATUS IS NOT HERE AND WAS NOT FORGOTTEN. `last-run-endtime` and friends come from
 *   `/admin/prune`, not from this endpoint: MEASURED, `GET /config/prune/{id}` returns exactly
 *   comment, disable, id, the six keep-*, max-depth, ns, schedule and store — no digest, no status.
 *   Reporting a last-run time would make a plan's output change when nothing changed, and a plan
 *   whose output moves on its own is one people stop reading. `/admin/prune/{id}/run` triggers a
 *   prune by hand and is deliberately not modelled: running one is an act, not a declaration.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PbsTarget } from './credentials.ts';
import { createBody, keepAttributes, keepsMatch, updateBody } from './pbs-prune-job-form.ts';
import { type PveRequirements, type WithPbsTarget, pveHandlers } from './resource.ts';
import { bool, int, text } from './values.ts';

/**
 * ⚠️ THE PROPS ARE PBS'S OWN KEY NAMES, HYPHENS INCLUDED, for backup-job.ts's reason: the form
 *   builder is then a copy rather than a translation table, and a translation table is one more
 *   place for a key to be renamed and silently never sent. Here a field that is never sent is a
 *   retention window that never applies.
 */
export interface PruneJobProps extends WithPbsTarget {
  /** ⛔ A PBS host, not a PVE one. See `PbsTarget` and the credential ⛔ in the header. */
  target: PbsTarget;
  /**
   * ⛔ The primary key, REQUIRED, and PBS does not generate one. Measured: 3–32 chars matching
   * `^[A-Za-z0-9_][A-Za-z0-9._\-]*$`. To adopt a job that exists, declare its existing id — any
   * other id is a SECOND prune job on the same datastore, and two prune jobs do not negotiate.
   */
  id: string;
  /** ⚠️ The datastore this prunes. Changing it re-points the job rather than adding one: the old
   * store stops being pruned and the new one starts, with these windows, at the next run. */
  store: string;
  /**
   * A systemd calendar event, e.g. `daily` or `sat 02:30`. ⛔ REQUIRED — measured, it is the one
   * non-optional field of `POST /config/prune` besides `id` and `store`, and it is NOT in the PUT
   * `delete` enum, so there is no way to un-schedule a job short of disabling or removing it.
   * ⚠️ THIS COMPARES STRINGS, NOT MEANINGS. A calendar event has many equivalent spellings and PBS
   *   stores the one it was handed; declare the spelling the server echoes back.
   */
  schedule: string;
  /** Namespace to prune, `''` or unset for the root one. ⚠️ Scope, so read it with `max-depth`. */
  ns?: string;
  /** ⛔ UNSET MEANS FULL RECURSION, NOT NONE — see the ⛔ in the header. 0–7. Declare it. */
  'max-depth'?: number;
  /** ⚠️ Undeclared is UNMANAGED, so a job somebody disabled by hand stays disabled. That is the
   * deliberate direction for a destructive job: never switch one on that nobody asked for. */
  disable?: boolean;
  comment?: string;
  /** ⚠️ Every window below is `minimum: 1` (measured) and undeclared means unmanaged. */
  'keep-last'?: number;
  'keep-hourly'?: number;
  'keep-daily'?: number;
  'keep-weekly'?: number;
  'keep-monthly'?: number;
  'keep-yearly'?: number;
}

export interface PruneJobAttributes {
  id: string;
  store: string;
  schedule: string;
  ns: string;
  /** ⚠️ `-1` is ABSENT — and absent means full recursion. `0` is the real "no recursion" setting. */
  'max-depth': number;
  disable: boolean;
  comment: string;
  /** ⚠️ `0` is ABSENT in all six. PBS's own minimum is 1, so zero can never be a live value. */
  'keep-last': number;
  'keep-hourly': number;
  'keep-daily': number;
  'keep-weekly': number;
  'keep-monthly': number;
  'keep-yearly': number;
}

export interface PbsPruneJob extends Resource<
  'Pbs.PruneJob',
  PruneJobProps,
  PruneJobAttributes,
  never,
  PveRequirements
> {}

/**
 * ★ NO `defaultRemovalPolicy: 'retain'`, UNLIKE Storage AND ZfsPool, AND THE REASON IS THE REVERSE
 *   OF THEIRS. Destroying this resource destroys a POLICY, and a policy is a line of TypeScript.
 *   The archives it would have trimmed are not touched by the DELETE — see the ⚠️ on the provider.
 */
export const PbsPruneJob = Resource<PbsPruneJob>('Pbs.PruneJob');

/** "Not declared, or equal" — the single shape every unmanaged field is compared with. */
const same = <T>(declared: T | undefined, live: T) => declared === undefined || declared === live;

const handlers = pveHandlers<PruneJobProps, PruneJobAttributes>({
  /**
   * ⚠️ EVERY OPTIONAL FIELD FALLS BACK TO ITS ABSENT SENTINEL RATHER THAN TO PBS'S DEFAULT, because
   *   for this family the two are different questions. `keep-daily` absent does not mean "keep zero
   *   dailies", it means "this window is not part of the policy", and `matches` must not compare a
   *   window the declaration never mentioned against an invented value.
   * ⛔ NO "IS IT REALLY THERE" GUARD, for backup-job.ts's reason: returning undefined for a job
   *   whose JSON is missing a key would be a guess about which keys PBS echoes, and a wrong guess
   *   sends reconcile down the POST branch — which creates ANOTHER prune job rather than failing.
   */
  attributes: (live, props) => ({
    comment: text(live['comment'], ''),
    disable: bool(live['disable'], false),
    id: props.id,
    ...keepAttributes(live),
    'max-depth': int(live['max-depth'], -1),
    ns: text(live['ns'], ''),
    schedule: text(live['schedule'], ''),
    store: text(live['store'], props.store),
  }),
  collection: () => 'config/prune',
  createForm: createBody,
  /**
   * ⚠️ THE UNDECLARED HALF IS NOT COMPARED, AND THAT IS THE WHOLE SAFETY MODEL. `same` reads "not
   *   declared, or equal", so a field set by hand on an adopted job survives adoption untouched and
   *   never appears as drift. `keepsMatch` applies the identical rule to the six windows, from the
   *   file that also writes and reads them — see the ★ at the top of pbs-prune-job-form.ts.
   * ⚠️ `store` AND `schedule` HAVE NO UNDECLARED CASE because both are required props, so both are
   *   compared unconditionally. A changed `store` is an update, not a replace: PBS accepts `store`
   *   on PUT, so the job is re-pointed in place.
   */
  matches: (attributes, props) =>
    attributes.schedule === props.schedule &&
    attributes.store === props.store &&
    same(props.ns, attributes.ns) &&
    same(props['max-depth'], attributes['max-depth']) &&
    same(props.disable, attributes.disable) &&
    same(props.comment, attributes.comment) &&
    keepsMatch(attributes, props),
  path: (props) => `config/prune/${props.id}`,
  updateForm: updateBody,
});

/**
 * ⛔ `list` IS EMPTY like every other family here, and the stakes are the usual ones read backwards.
 *   `GET /config/prune` hands back every prune job on the server, the ones an operator tuned by
 *   hand included. Adopting those would give Alchemy the right to REWRITE their retention the first
 *   time a declaration disagreed — and rewriting retention is deleting backups. Adoption stays an
 *   explicit act: name the id you mean.
 *
 * ⚠️ THE DELETE IS THE SAFE DIRECTION, AND IT IS STILL NOT FREE. Removing a prune job deletes
 *   NOTHING: the archives that survived the last run stay exactly where they are. What goes away is
 *   the only thing trimming that datastore, so the failure mode is a datastore that fills up weeks
 *   later — an outage with no obvious cause and no backup written during it. Nothing on the server
 *   depends on a prune job, so PBS will not refuse this the way PVE refuses to delete a pool still
 *   holding guests; the plan line is the only warning anyone gets.
 *   ⚠️ DELETE ALSO NEEDS A DIFFERENT PRIVILEGE FROM THE WRITES — `Datastore.Verify`, not
 *     `Datastore.Modify`. See the ⚠️ in the header before assuming a working create means a working
 *     destroy.
 */
export const PbsPruneJobProvider = () =>
  Provider.effect(PbsPruneJob, Effect.succeed(PbsPruneJob.Provider.of(handlers)));
