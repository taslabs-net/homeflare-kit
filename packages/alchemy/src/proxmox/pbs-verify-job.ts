/**
 * `Pbs.VerifyJob` — one section of PBS's `verification.cfg`, declared.
 *
 * ★ THIS IS THE FAMILY THAT ANSWERS "ARE THE BACKUPS ACTUALLY GOOD", AND NOTHING ELSE IN THIS
 *   PACKAGE DOES. A datastore reports free space, a prune job reports that it ran, and every
 *   snapshot in the store can still be unreadable: PBS learns a chunk has rotted only when
 *   something reads it back and checks its digest, and verification is the only thing that does
 *   that on a schedule. An undeclared verify job is the reason nobody notices for months — and a
 *   green `Proxmox.BackupJob` makes it worse rather than better, because a vzdump job that says
 *   "OK" every night is exactly the evidence people stop at.
 *
 * ⛔ THIS FILE CANNOT AUTHENTICATE UNTIL TWO THINGS OUTSIDE IT CHANGE, AND IT IS SHIPPED SAYING SO
 *   RATHER THAN SHIPPED LOOKING FINISHED. Both are recorded on `PbsTarget` below:
 *     1. `credentials.ts` has no PBS mint. MEASURED 2026-09-13 from this Mac: the agent's
 *        approle is refused `sys/mounts`, `kv/infra/proxmox` and `proxmox-pbs/creds/read` alike —
 *        403 permission denied on all three — so there is no mount to name and none is invented.
 *     2. `client.ts`'s `authorization()` builds a PVE header, and PBS will not accept it. See the
 *        ⛔ on `PbsTarget`.
 *   Until both land, every call 401s, `pveOperations.read` folds that into "absent", and the plan
 *   reports `create` for a job that is plainly there. The deploy then FAILS at the POST rather
 *   than clobbering anything — an unauthenticated POST 401s, and an authenticated one is refused
 *   because PBS will not take a duplicate section id — so the cost is a LYING PLAN and a broken
 *   run, not a lost job. That is still reason enough not to wire it into a stack yet: a plan
 *   nobody can trust is its own outage.
 *
 * ⚠️ THE SHAPES BELOW ARE READ FROM PUBLISHED SOURCE, NOT MEASURED ON THIS ESTATE. Everything is
 *   taken from `pbs-api-types/src/jobs.rs`, `src/api2/config/verify.rs`, `src/server/verify_job.rs`
 *   and `src/backup/verify.rs` at HEAD of the Proxmox git mirrors on 2026-09-13. What WAS measured
 *   here: `pbs.example.com:8007` and `pbs.mgmt.example.com:8007` both answer HTTP 401 under
 *   STRICT TLS (curl `ssl_verify_result=0`), so no `-k` is needed and `client.ts`'s plain `fetch`
 *   reaches PBS unchanged. The running host's own schema was NOT read — no credential — so a PBS
 *   older than HEAD may differ.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PbsTarget } from './credentials.ts';
import { rechecks, shape } from './pbs-verify-job-form.ts';
import { type PveRequirements, pveHandlers } from './resource.ts';
import { bool, int, text } from './values.ts';

export interface PbsVerifyJobProps {
  /** ⛔ A PBS host, never a PVE cluster. See `PbsTarget`. */
  target: PbsTarget;
  /**
   * ⛔ The primary key, REQUIRED, and never left to PBS. 3–32 chars of
   * `[A-Za-z0-9_][A-Za-z0-9._-]*`. PBS refuses a duplicate section id outright, which is the loud
   * failure `Proxmox.BackupJob` had to engineer for itself — but only because the id is sent.
   */
  id: string;
  /** Datastore name, 3–32 safe-id chars. ⚠️ MUTABLE — see the ⚠️ on `matches`. */
  store: string;
  /**
   * ⛔ THE KEY IS REQUIRED AND THE VALUE MAY BE `null`. PBS makes the field optional; this family
   * refuses to let you OMIT it, which is not the same thing. A verification job with no schedule
   * never runs on its own and PBS reports it as perfectly healthy — and an absent schedule is also
   * the only way to turn one off, because there is NO `disable` field on a verification job.
   * ⛔ THAT LAST CLAIM IS NOW MEASURED, not read from source. `proxmox-backup-manager verify-job
   *   update --help` on the live 4.2 host lists `--delete
   *   ignore-verified|comment|schedule|outdated-after|ns|max-depth|read-threads|verify-threads`
   *   and no `--disable` anywhere. So `schedule` is deletable — "parked" is a state PBS supports —
   *   and `disable` genuinely does not exist. pbs-verify-job-form.ts said this was read off the
   *   source and NOT verified against a running host; it is now verified, on this one.
   * ★ SO `null` MEANS "DELIBERATELY PARKED" AND OMITTING IT IS STILL AN ERROR. The original
   *   required-string kept you from declaring verification that never happens, which is right, but
   *   it also made a genuinely parked job UNDECLARABLE — and the estate has one: `v-datacenter` is
   *   parked because syno1 is powered off, comment and runbook and all. A resource that cannot
   *   describe what is really there pushes the operator back to the CLI, which is the failure this
   *   package exists to end. Writing `schedule: null` costs a word and says the quiet part out
   *   loud; leaving the key out still will not compile.
   * ⚠️ ADOPTING A SCHEDULELESS JOB WITH A SCHEDULE DECLARED GIVES IT ONE ON THE FIRST DEPLOY, which
   *   is the intended direction and is still a write nobody asked for in words. `matches` compares
   *   `schedule`, the live value reads `''`, so the first reconcile PUTs the declared one and
   *   verification starts running that night. Read the first plan against an adopted job.
   * ⚠️ A systemd calendar event. Spelled `daily`, `sat 02:00`, `mon..fri 23:00`. A step expression
   *   is legal too and is not written out here: those two characters would close this comment.
   */
  schedule: string | null;
  /**
   * The namespace to verify, e.g. `tier1/prod`. Omitted means the datastore root.
   * ⛔ NEVER SENT AS THE EMPTY STRING. MEASURED in the update handler: `if !ns.is_root()` — a root
   *   namespace on a PUT is accepted by the schema, reaches the handler and is then SILENTLY
   *   DISCARDED. A job cannot be moved back to the root namespace by this resource at all; that
   *   needs `--delete ns` by hand. So an undeclared `ns` is neither sent nor compared.
   */
  ns?: string;
  /**
   * How many namespace levels below `ns` to descend. `0` is that level only; PBS's maximum is 7.
   * ⚠️ PBS's own default is FULL recursion (7), not 0. Undeclared means undeclared here: not sent,
   *   not compared, because "unset" and "7" are stored differently and only one is reachable.
   */
  'max-depth'?: number;
  /**
   * ⛔ THE HALF OF THE PAIR THAT DECIDES WHETHER THIS JOB EVER RE-CHECKS ANYTHING. Defaults to
   *   TRUE. Read `rechecks` and the ⛔ in pbs-verify-job-form.ts before setting either of these.
   */
  'ignore-verified'?: boolean;
  /** Days after which a past verification is stale. ⛔ See the pair's ⛔ in the form file. */
  'outdated-after'?: number;
  /** ⚠️ PBS TRIMS IT AND STORES AN EMPTY ONE AS ABSENT, so `'  '` reads back as `''`. */
  comment?: string;
}

export interface PbsVerifyJobAttributes {
  id: string;
  store: string;
  schedule: string;
  ns: string;
  /** ⚠️ `-1` means "no max-depth in the section". `0` is a real setting meaning no recursion. */
  'max-depth': number;
  'ignore-verified': boolean;
  /** ⚠️ `-1` means "unset", which is NOT `0`. See the ⛔ in the form file. */
  'outdated-after': number;
  comment: string;
  /**
   * ★ WHAT THIS JOB ACTUALLY RE-CHECKS, IN ENGLISH, COMPUTED FROM THE LIVE PAIR. REPORTED, NEVER
   *   COMPARED — it is derived from two fields `matches` already compares, so diffing it would
   *   double-count them. It exists because the failure this family guards against is a job that
   *   looks healthy in every column and verifies each snapshot exactly once, ever; that job reads
   *   `never` here. A plan line is the only place anyone will see it.
   */
  rechecks: string;
}

export interface PbsVerifyJob extends Resource<
  'Pbs.VerifyJob',
  PbsVerifyJobProps,
  PbsVerifyJobAttributes,
  never,
  PveRequirements
> {}

/**
 * ⚠️ NO `defaultRemovalPolicy: 'retain'`, DELIBERATELY, AND IT IS THE CLOSER CALL THAN IT LOOKS.
 *   The section holds no data — deleting it destroys nothing, the way `Proxmox.BackupJob`'s delete
 *   destroys no archives. What it destroys is the CHECKING, silently and permanently, and PBS will
 *   not refuse it the way it refuses to remove a datastore in use. `retain` would hide that behind
 *   a state-row drop instead of showing it as a plan line, and the plan line is the only warning
 *   anyone gets. Pipe `RemovalPolicy.retain()` per declaration where the job must outlive the code.
 */
export const PbsVerifyJob = Resource<PbsVerifyJob>('Pbs.VerifyJob');

/**
 * ⚠️ EVERY FIELD IS READ THROUGH `values.ts` THOUGH PBS RETURNS REAL JSON TYPES. Unlike PVE's
 *   SectionConfig round-trip, `GET /config/verify/{id}` serialises a Rust struct, so
 *   `ignore-verified` arrives as a JSON boolean and `max-depth` as a JSON number. `bool` and `int`
 *   accept both spellings, and using them costs nothing while covering the version that does not.
 * ⚠️ `digest` IS NOT AN ATTRIBUTE AND CANNOT BECOME ONE BY ACCIDENT. PBS puts it on the rpcenv, and
 *   the JSON formatter adds rpcenv attributes as SIBLINGS of `data` — `{"data":{…},"digest":"…"}` —
 *   so `client.ts`, which returns `body.data`, never sees it. That is lucky rather than designed:
 *   the digest covers verification.cfg as a FILE, so keeping it would churn this resource's state
 *   whenever an unrelated verify job was edited.
 */
const handlers = pveHandlers<PbsVerifyJobProps, PbsVerifyJobAttributes>({
  attributes: (live, props) => {
    const ignoreVerified = bool(live['ignore-verified'], true);
    const outdatedAfter = int(live['outdated-after'], -1);
    return {
      comment: text(live['comment'], ''),
      id: props.id,
      'ignore-verified': ignoreVerified,
      'max-depth': int(live['max-depth'], -1),
      ns: text(live['ns'], ''),
      'outdated-after': outdatedAfter,
      rechecks: rechecks(ignoreVerified, outdatedAfter),
      schedule: text(live['schedule'], ''),
      store: text(live['store'], props.store),
    };
  },
  /**
   * 🔴 THIS WAS `config/verification` AND PBS ANSWERS 404 FOR IT. MEASURED on the live 4.2 server:
   *   `GET /api2/json/config/verification` -> 404 "Path not found"; `GET /api2/json/config/verify`
   *   -> 200 with both jobs. The struct is `VerificationJobConfig` and the CLI subcommand is
   *   `verify-job`, so the long spelling reads right and is simply not the route.
   *   ⛔ THE FAILURE MODE IS THE ONE THIS PACKAGE KEEPS FINDING: `read` folds every failure into
   *   `undefined`, so a 404 from a WRONG PATH is indistinguishable from an object that is not
   *   there. The first plan against the live estate said `create` for two verification jobs that
   *   have existed for weeks — and a create would then have POSTed to a 404 as well, so it fails
   *   loudly rather than duplicating anything. Nothing caught it earlier because no verification
   *   job had ever been declared; registering the provider exercises no path at all.
   */
  collection: () => 'config/verify',
  /** ⛔ `id` IS SENT. PBS refuses a duplicate id, and that refusal is this family's safety net. */
  createForm: (props) => ({ ...shape(props), id: props.id }),
  /**
   * ⚠️ AN UNDECLARED FIELD IS NEITHER SENT NOR COMPARED — the `Proxmox.BackupJob` trade, for the
   *   same reason and with one extra: this form carries NO `delete` list, so there is nothing it
   *   could clear even if it wanted to. See the ⛔ on `withClears` in pbs-verify-job-form.ts.
   * ⚠️ `store` IS COMPARED AND IS MUTABLE, which is unusual and worth reading twice. PBS's update
   *   handler assigns it and re-checks privileges on both the old and the new path, so changing
   *   `store` MOVES the job — and the datastore it left is then verified by nothing. That is a
   *   one-word edit with the same effect as deleting the job, and it plans as a quiet `update`.
   * ⚠️ `rechecks` IS ABSENT HERE ON PURPOSE. It is a rendering of the two fields on the lines
   *   above; comparing it too would report the same drift twice.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pbs:POST /config/verify', update: 'pbs:PUT /config/verify/{id}' },
  matches: (attributes, props) =>
    attributes.store === props.store &&
    // ⚠️ `null` IS COMPARED AGAINST `''`, NOT SKIPPED. A parked job is a declaration like any
    //   other, so declaring `null` against a job that HAS a schedule must plan an update — the
    //   form then omits `schedule`, which is a set-only form, so see the ⛔ on clearing below.
    attributes.schedule === (props.schedule ?? '') &&
    attributes['ignore-verified'] === (props['ignore-verified'] !== false) &&
    (props['outdated-after'] === undefined ||
      attributes['outdated-after'] === props['outdated-after']) &&
    (props['max-depth'] === undefined || attributes['max-depth'] === props['max-depth']) &&
    (props.ns === undefined || attributes.ns === props.ns) &&
    (props.comment === undefined || attributes.comment === props.comment),
  path: (props) => `config/verify/${props.id}`,
  updateForm: shape,
});

/**
 * ⛔ `list` IS EMPTY, INHERITED FROM `pveHandlers`, AND THE REASON IS SHARPER HERE THAN ELSEWHERE.
 *   `GET /config/verify` returns every verification job the caller can see, including the
 *   ones the PBS installer and a human made. Adopting those would put Alchemy one dropped line
 *   away from DELETING a datastore's only verification schedule — and deleting it destroys nothing
 *   visible, so the loss is discovered the day a restore fails and there is no verification history
 *   to say when the rot started. Adoption stays explicit: declare the existing id.
 *
 * ⚠️ NO `digest` IS SENT ON UPDATE OR DELETE, SO THIS IS LAST-WRITER-WINS. PBS accepts an optional
 *   `digest` on both and would refuse a write made against a stale read. Sending one would need a
 *   read-then-write window this provider does not have — `pveOperations` reads and writes in two
 *   separate calls with two separate mints — so a concurrent edit from the PBS UI is overwritten
 *   rather than refused. Same behaviour as every PVE family here; stated because PBS offers better.
 */
export const PbsVerifyJobProvider = () =>
  Provider.effect(PbsVerifyJob, Effect.succeed(PbsVerifyJob.Provider.of(handlers)));
