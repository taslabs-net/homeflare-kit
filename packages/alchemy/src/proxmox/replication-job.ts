/**
 * `Proxmox.ReplicationJob` — a guest's ZFS storage replication to a second node, declared.
 *
 * ⛔ NOTHING ON C1 CAN USE THIS FAMILY, AND THAT IS SAID HERE RATHER THAN FOUND OUT LATER. PVE
 *   storage replication is ZFS-only: `POST /cluster/replication` calls `get_replicatable_volumes`
 *   and refuses a guest whose disks are anywhere else with "No replicatable volumes found". C1 is
 *   Ceph/RBD-backed — shared storage, where replication means nothing because every node already
 *   sees the volume — so `GET /cluster/replication` answers `[]` (MEASURED on node-b, 2026-09-13) and
 *   on this cluster always will. The file is written for a ZFS cluster; against C1 a declaration
 *   is a create that fails with PVE's own sentence, not a plan that quietly does nothing.
 *
 * ★ WHAT IS MEASURED HERE AND WHAT IS REASONED. Measured on node-b (pve-manager 9.2.11), read-only:
 *   the published schema for all five methods; `PVE/ReplicationConfig.pm` and
 *   `PVE/API2/ReplicationConfig.pm` line by line; `GET /cluster/replication` -> `[]`; and the ACL
 *   row `{"path":"/","propagate":1,"roleid":"PVEAuditor","ugid":"hf-read@pve"}`. NOT measured: any
 *   round trip. There is no live job to adopt and none can be created on this cluster, so the
 *   argument that a matching declaration plans as `noop` rests on the schema and on PVE's own
 *   source — not on a plan anybody ran. Nobody should claim otherwise until a ZFS cluster exists.
 *
 * ⛔ THE ID IS STRUCTURED AND PVE RE-SPELLS IT, so this resource is keyed on the two numbers rather
 *   than on the string — a deliberate break from `backup-job.ts`'s "props are PVE's own key names".
 *   MEASURED: `parse_replication_job_id` matches `^(\d+)-(\d+)$`, runs BOTH halves through `int()`
 *   and returns "$guest-$jobnum", and `parse_section_header` does the same when reading
 *   replication.cfg. So a declared `100-007` is read back as `100-7`, and a provider holding the
 *   raw string would compare two spellings of one id forever. Two numbers cannot be spelled two
 *   ways. PVE also refuses `guest < 100` ("guest IDs < 100 are reserved") and the API pattern
 *   `[1-9][0-9]{2,8}-\d{1,9}` caps both halves at nine digits.
 *   ⛔ BOTH HALVES ARE REQUIRED AND NEITHER IS DEFAULTED, for `backup-job.ts`'s reason: a provider
 *     that picks a job number picks a DIFFERENT job from the one a person meant, and then adopts or
 *     creates beside the real one. Declare the numbers of the job you mean.
 *
 * ⛔ PVE'S `target` AND THIS PACKAGE'S `target` ARE DIFFERENT THINGS, AND THE COMPILER SAID SO
 *   BEFORE A REVIEWER DID. Every resource here extends `WithTarget`, whose `target` is the CLUSTER
 *   a call goes to (`PveTarget`, carrying the API base and the credential mount). PVE's replication
 *   `target` is a NODE NAME. They cannot both be called `target` in one props interface — tsc:
 *   "Interface 'ReplicationJobProps' incorrectly extends interface 'WithTarget'" — so the prop and
 *   the attribute are `targetNode`, and PVE's spelling appears exactly once, in `createBody`, where
 *   it is the wire key. That is the only safe shape: had the collision been resolvable by silence,
 *   `createForm` would have serialised a whole `PveTarget` object into a form field called `target`
 *   and PVE would have answered that the node does not exist.
 *
 * ⛔ ONE JOB PER (GUEST, TARGET), ENFORCED BY PVE AND NOT BY THIS FILE. MEASURED: `write_config`
 *   dies "replication job for guest '$vmid' to target '$tid' already exists" where `$tid` is
 *   `local/<target>`, and `parse_config` DELETES the loser on read if two ever reach the file. Two
 *   declarations differing only in `jobnum` but naming the same target are not two jobs; the second
 *   is a create that fails.
 *
 * ⚠️ RECONCILE NEEDS `VM.Replicate` ON `/vms/<guest>`, WHICH THE PROVISION ROLE DOES NOT HOLD. All
 *   three writes check it (MEASURED in API2/ReplicationConfig.pm: create, update and delete each
 *   call `$rpcenv->check($authuser, "/vms/$vmid", ['VM.Replicate'])`), and the role's 27 privileges
 *   include `VM.Allocate`, `VM.Audit`, `VM.Backup`, `VM.Config.*` and `VM.PowerMgmt` but not
 *   `VM.Replicate` (`PROVISION_PRIVILEGES`). Do NOT widen it by hand: the baseline declares the
 *   role's exact set, so a hand-added privilege is removed on the next deploy. Grant a second role
 *   holding `VM.Replicate` on `/vms/<guest>` instead.
 *   ★ THE READ LANE NEEDS NOTHING EXTRA, which is why there is no `readRole` below. The ITEM read
 *     checks `VM.Audit` on `/vms/<guest>`, `hf-read@pve` holds the built-in `PVEAuditor` at `/`
 *     with propagate — both MEASURED — and `PVEAuditor` carries `VM.Audit`. This family is not a
 *     fourth one that must borrow the provision lease.
 *   ⚠️ A MISSING JOB IS A 500, NOT A 404 — "no such replication job '100-0'" — and distilled now
 *     exposes a precise missing-job tag. Permission failures and unrelated server errors propagate
 *     before any write; only the vendor missing-job signal means absent.
 *
 * ⛔ DELETE DOES NOT DELETE, AND A DESTROY IS NOT FREE. MEASURED: with neither `force` nor `keep` —
 *   and the named SDK delete sends neither option — the handler only sets `remove_job = 'full'`
 *   on the job and writes the config back. The job stays in replication.cfg until the SOURCE node's
 *   `pvesr` timer next runs it, at which point it removes the local replication snapshots, removes
 *   the replicated volumes on the target, and finally removes itself. So a destroy costs the
 *   standby copy and the incremental base: re-declaring the job afterwards is a FULL send, not a
 *   resume. The guest's own disks are untouched, which is exactly why this family does NOT carry
 *   `defaultRemovalPolicy: 'retain'` the way `ZfsPool` and `Storage` do — what it destroys is a
 *   copy a re-sync rebuilds, expensively, rather than something irreplaceable.
 *   ⚠️ AND IF THE SOURCE NODE IS DOWN THE REMOVAL NEVER RUNS. Alchemy drops the state row on a
 *     DELETE that returned no error, so a destroy against a dead source leaves a marked job on the
 *     cluster that nothing declares any more. `GET /cluster/replication` is where it shows up.
 *
 * ⚠️ THE RUNTIME STATUS IS NOT HERE, AND NOT BECAUSE IT WAS FORGOTTEN. `last_sync`, `last_try`,
 *   `fail_count`, `error`, `duration` and `pid` come from the per-node replication STATE file and
 *   are merged in by `GET /nodes/{node}/replication` (MEASURED: API2/Replication.pm line 179,
 *   `foreach my $k (qw(last_sync last_try fail_count error duration))`). `GET
 *   /cluster/replication/{id}` — the only endpoint this resource reads — returns not one of them.
 *   Reporting them would mean a second, per-node call on the read path answering a different value
 *   every fifteen minutes, and a plan whose output changes when nothing changed is a plan people
 *   stop reading. Ask the node for status; ask the cluster for configuration.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { replicationJobHandlers } from './replication-job-lifecycle.ts';

export interface ReplicationJobProps extends WithTarget {
  /** ⛔ The guest being replicated. 100 or above — PVE reserves everything below. Identity. */
  guest: number;
  /** ⛔ The job number within that guest, 0 upwards. Identity. Never generated — see the header. */
  jobnum: number;
  /**
   * ⛔ THE NODE THE COPY LANDS ON — PVE's `target`, RENAMED; see the ⛔ in the header — AND IT IS
   *   CREATE-ONLY. MEASURED: the plugin declares `target => { fixed => 1, optional => 0 }`, so
   *   `updateSchema()` omits it entirely — `PUT` has no `target` parameter at all, and
   *   `delete=target` answers "unable to delete fixed option". It is therefore NOT compared; see
   *   the ⚠️ on `matches`. Changing it in a declaration plans as NOOP. Retire the declaration and
   *   add another, exactly as `user.ts` says for `userid`.
   * ⚠️ PVE refuses a target equal to the guest's current node ("Source and target must not be
   *   identical") and one that is not a cluster member. Neither is checkable from here.
   */
  targetNode: string;
  /**
   * A subset of systemd calendar events. Unset means PVE's own default — `DEFAULT_SCHEDULE`,
   * every fifteen minutes — and that default is what gets SENT and compared, not silence.
   * ⚠️ THIS COMPARES STRINGS, NOT MEANINGS. A calendar event has many equivalent spellings and
   *   PVE stores the one it was handed, verbatim, so declare the spelling the cluster echoes.
   */
  schedule?: string;
  /** Rate limit in mbps as a float, 1 or above. Unset sends nothing and compares nothing. */
  rate?: number;
  /** Keep the job but stop replicating. Unset is an ACTIVE job, and that is what is compared. */
  disable?: boolean;
  /** Free text shown in the UI. Round-trips through PVE's `encode_text`/`decode_text`. */
  comment?: string;
}

export interface ReplicationJobAttributes {
  /** `100-0`, in PVE's own int-parsed spelling. */
  id: string;
  /**
   * ⚠️ REPORTED AS INTEGERS, NEVER COMPARED, AND THIS IS THE "id written as a name" TRAP. MEASURED:
   *   `parse_config` sets both from the section header via `int()`, so they are the id re-spelled
   *   as numbers and no write accepts either. Compared against anything they would be an update
   *   forever; reported, they let a plan say which guest is about to lose a replica.
   */
  guest: number;
  jobnum: number;
  /** Always `local` — the only section type PVE registers. Create-only, reported, not compared. */
  type: string;
  /**
   * ⚠️ REPORTED, NEVER COMPARED. Create-only AND rewritten by PVE — see `matches`. Named for the
   *   prop rather than for PVE's wire key `target`, so that one file never means two things by one
   *   word; the header says why the wire name could not be kept.
   */
  targetNode: string;
  /** ⚠️ REPORTED, NEVER SENT. PVE's own bookkeeping — see the ⛔ in replication-job-form.ts. */
  source: string;
  schedule: string;
  /** 0 when unset. See `rateOf`. */
  rate: number;
  disable: boolean;
  comment: string;
  /**
   * `''`, `local` or `full`. ⛔ NOT COSMETIC: a non-empty value is a job that is deleting itself,
   *   so `matches` refuses it and `updateBody` clears it. See both.
   */
  remove_job: string;
}

export interface ProxmoxReplicationJob extends Resource<
  'Proxmox.ReplicationJob',
  ReplicationJobProps,
  ReplicationJobAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxReplicationJob = Resource<ProxmoxReplicationJob>('Proxmox.ReplicationJob');

/**
 * ⛔ Empty `list` like every other resource here: `GET /cluster/replication` hands back every job an
 *   operator ever made, and adopting one is how a later `alchemy destroy` takes away a standby copy
 *   nobody declared. Adoption is an explicit act — declare the `guest` and `jobnum` you mean.
 * ⚠️ NOTHING BRAKES THIS DESTROY. PVE refuses to delete a pool that still holds guests; it accepts
 *   this without a word, because nothing depends on a replication job. Re-read the DELETE ⛔ at the
 *   top of this file before approving a plan line that removes one.
 */
export const ProxmoxReplicationJobProvider = () =>
  Provider.effect(
    ProxmoxReplicationJob,
    Effect.succeed(ProxmoxReplicationJob.Provider.of(replicationJobHandlers)),
  );
