/**
 * `Proxmox.CephFlag` — one cluster-wide Ceph OSD flag, declared: `noout`, `pause`, `norebalance`.
 *
 * ★ ONE RESOURCE PER FLAG, NOT ONE CARRYING ALL ELEVEN, AND THE CLUSTER'S OWN API DECIDED IT.
 *   MEASURED on C1 2026-09-13 (pve-manager 9.2.11, ceph tentacle 20.2.2) by reading
 *   `/usr/share/perl5/PVE/API2/Cluster/Ceph.pm` and the published schema in
 *   `/usr/share/pve-docs/api-viewer/apidoc.js`:
 *     · `PUT /cluster/ceph/flags` ends in `fork_worker('cephsetflags', ...)` and returns a STRING
 *       — a UPID. The bulk write is ASYNCHRONOUS, and this package has no task-polling machinery.
 *     · `PUT /cluster/ceph/flags/{flag}` calls `$rados->mon_command` inline and returns null. The
 *       per-flag write is SYNCHRONOUS.
 *   `pveOperations.reconcile` READS BACK after every write and refuses to record a value it did
 *   not see. Against the bulk endpoint that read-back races a worker which has not run yet, so it
 *   would record the OLD value as the new attributes — the one honesty mechanism in this package
 *   turned into a lie generator. Per-flag, the read-back means what it says.
 *   ★ THE SECOND REASON IS SMALLER AND STILL REAL. The bulk GET answers rows of
 *     `{name, description, value}`, and `description` is PVE's own English prose that no write
 *     accepts: compare it and you have a forever-update, report it and this provider is pretending
 *     to manage prose. `GET /cluster/ceph/flags/{flag}` answers a BARE BOOLEAN, so that trap
 *     cannot be written here at all. The brief's plural `Proxmox.CephFlags` became singular for
 *     those two reasons; the bulk endpoint is read by nothing in this package.
 *
 * ⛔ THESE ARE NOT CONFIGURATION. THEY ARE A HAND ON THE BRAKE, AND A DECLARATION CAN PULL IT OFF.
 *   `noout` is what a person sets before pulling a disk. A stack saying `value: false` reasserts
 *   that off on EVERY deploy — including a deploy somebody else runs, for an unrelated resource,
 *   twenty minutes into a maintenance window — and the plan line reads `Proxmox.CephFlag noout
 *   update`, which nobody reads as "ceph is about to start rebalancing 128 PGs across three nodes
 *   while a disk is out of the chassis".
 *   ★ SO `value` IS REQUIRED AND HAS NO DEFAULT, AND THAT IS THE MITIGATION. An optional `value`
 *     defaulting to false would make `CephFlag('noout', { flag: 'noout', target })` mean "clear
 *     it" — the dangerous direction, chosen by OMISSION. Here the dangerous sentence has to be
 *     typed out by a person. Do not add a default, and do not declare a flag merely to document
 *     that it is off: MEASURED 2026-09-13, all eleven flags on C1 read 0, so eleven
 *     `value: false` lines would plan green forever and do nothing except take the brake off
 *     whenever somebody happens to apply them.
 *
 * ⛔ `delete` DOES NOTHING, ON PURPOSE, AND THE ASYMMETRY OF THE TWO FAILURES IS THE ARGUMENT.
 *   `flags/{flag}` has exactly two methods, GET and PUT, so the factory's `destroy` would answer
 *   "Method 'DELETE /cluster/ceph/flags/noout' not implemented" on every teardown — whatever this
 *   handler does is INVENTED. The obvious invention, "clear the flag", is refused: removing a line
 *   from a stack file, or Alchemy collecting an old generation after a replace, would silently
 *   take the brake off and nothing would warn. Leaving a flag set that nothing declares any more
 *   is the opposite kind of failure — ceph reports `HEALTH_WARN ... flag(s) set` for every one of
 *   these, on `ceph -s`, in the PVE UI and in the `pve_*` metrics this estate already scrapes.
 *   A silent destructive failure loses to a loud inert one.
 *   ⚠️ THE RESIDUAL RISK, NAMED RATHER THAN DENIED: deleting a `value: true` declaration LEAVES
 *     THE FLAG SET. Retire a maintenance window by flipping the line to `value: false` and
 *     deploying BEFORE the line is removed, or a `noout` outlives the window that needed it.
 *   ⚠️ REASONED, NOT MEASURED: that health warning was not observed, because observing it means
 *     setting a flag on a live cluster and this file was researched read-only. Undeclaring stops
 *     MANAGING a flag; to clear one, declare `value: false` and deploy, where a plan says so.
 *
 * ⛔ `pause` IS TWO CEPH FLAGS AND THIS RESOURCE READS ONLY ONE OF THEM. MEASURED in
 *   `PVE::Ceph::Tools::get_real_flag_name`, whose own comment reads "the 'pause' flag gets always
 *   set to both 'pauserd' and 'pausewr'": PVE writes both and then decides the flag is set by
 *   looking at `pauserd` alone. A cluster where somebody ran `ceph osd unset pauserd` by hand
 *   still has `pausewr` — writes blocked, guests hung — and this resource reports `value: false`
 *   and plans `noop` straight past it. It cannot express a half-pause, so never use it to prove
 *   one is gone; `ceph osd dump | head -1` can.
 *   ⛔ `pause` AND `noup` ARE ALSO THE TWO THAT TAKE THE CLUSTER DOWN FROM A TYPO. `pause: true`
 *     stops all reads and writes, so every guest on `rbd-c1` — the cluster's only rbd pool,
 *     MEASURED 2026-09-13 — freezes on its root disk, and so does `cephfs-c1`. `noup: true`
 *     stops a rebooted OSD from ever rejoining. Neither is undone by deleting the line.
 *
 * ⚠️ PRIVILEGES, AND THE WRITE ONE IS A BIG ASK. Both GETs check `Sys.Audit` on `/`; both PUTs
 *   check `Sys.Modify` on `/`, and all four carry `allowtoken => 1`, so an API token may make the
 *   call at all. There is no `/ceph` ACL object to scope to — the check names the ROOT path
 *   literally — so granting the provision role `Sys.Modify` here also buys datacenter options,
 *   metric servers, notification targets and every other cluster-wide write, exactly as
 *   metric-server.ts warns about its own family.
 *   ⚠️ REASONED, NOT MEASURED: nothing here was exercised under a minted lease, because a mint
 *     writes an API token into the cluster and the brief for this file was reads only. Expect
 *     "Permission check failed (/, Sys.Modify)" on the first deploy, and widen deliberately.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import {
  CEPH_FLAG_UPDATE,
  readClusterCephFlag,
  readClusterCephFlagForDiff,
  updateForm,
  writeClusterCephFlag,
} from './ceph-flag-wire.ts';
import { mintTier } from './credentials.ts';
import { UNREADABLE, unreadableWarning } from './unreadable-read.ts';
import { guardWrite } from './distilled-guard.ts';
import type { CephFlagAttributes, CephFlagProps } from './ceph-flag-types.ts';
import type { PveRequirements } from './resource-spec.ts';
import { formToSend } from './update-guard.ts';

export type { CephFlagAttributes, CephFlagName, CephFlagProps } from './ceph-flag-types.ts';

export interface ProxmoxCephFlag extends Resource<
  'Proxmox.CephFlag',
  CephFlagProps,
  CephFlagAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxCephFlag = Resource<ProxmoxCephFlag>('Proxmox.CephFlag');

/**
 * ⚠️ `value` IS THE ONLY THING COMPARED, AND THE LIST OF THINGS DELIBERATELY NOT COMPARED IS THE
 *   point of this resource. `flag` is props-derived (see `CephFlagAttributes`). `description`
 *   and `name` exist only on the bulk GET, which this file does not read, so neither can be
 *   compared by accident. Nothing PVE returns here is rewritten, re-ordered or re-typed by the
 *   cluster, because all PVE returns here is one boolean.
 *   ★ MEASURED: on C1, `GET /cluster/ceph/flags` answers value 0 for all eleven flags, so a
 *     declaration of `value: false` reads back false and plans `noop`.
 */
const matches = (attributes: CephFlagAttributes, props: CephFlagProps) =>
  attributes.value === props.value;

/**
 * ★ MIGRATED OFF `pveHandlers`/`client.ts`'s generic `pve()` ONTO `@distilled.cloud/proxmox`'s
 *   typed `cluster.getClusterCephFlag`/`cluster.putClusterCephFlag` (ceph-flag-wire.ts).
 *   `pveHandlers` cannot run a distilled operation, so `diff`/`reconcile` are hand-written here,
 *   the same way ceph-pool.ts and backup-job.ts hand-write theirs for the same reason.
 *
 * ⛔ THIS FAMILY HAS NO CREATE KEY, AND THAT IS THE VENDOR'S DOING, NOT AN OMISSION HERE. PVE
 *   registers only `PUT /cluster/ceph/flags/{flag}`; `POST /cluster/ceph/flags` does not exist
 *   (constraints-forms.test.ts's own regression test), which is why the second ⛔ in the header
 *   above calls the create branch unreachable — there is no create form and no create endpoint to
 *   guard, only `CEPH_FLAG_UPDATE`.
 */
export const ProxmoxCephFlagProvider = () =>
  Provider.effect(
    ProxmoxCephFlag,
    Effect.succeed(
      ProxmoxCephFlag.Provider.of({
        /** ⛔ Empty, like every resource in this package — see resource.ts's own ⚠️ on why. */
        list: () => Effect.succeed([]),
        read: ({ olds }) => readClusterCephFlag(olds),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(CEPH_FLAG_UPDATE, updateForm(news), false);
          if (output === undefined) return undefined;
          // ⛔ Never absent — see the second ⛔ above. A failed read other than a refused mint
          //   propagates instead of reaching this point. A refused mint must NOT fail `diff`:
          //   that aborts the whole plan (unreadable-read.ts). `read` still propagates.
          const live = yield* readClusterCephFlagForDiff(news);
          if (live === UNREADABLE) {
            yield* unreadableWarning(
              'Proxmox.CephFlag',
              news.flag,
              news.target.mount,
              mintTier(news.target, 'read'),
            );
            return { action: 'noop' } as const;
          }
          return { action: matches(live, news) ? 'noop' : 'update' } as const;
        }),
        /** ⛔ Inert, deliberately. The third ⛔ in the header is the whole argument; read it. */
        delete: () => Effect.void,
        /**
         * ⚠️ THE READ-BACK GUARD, RESTORED FOR A FAMILY WHOSE "ABSENT" DOES NOT EXIST. A generic
         *   `reconcile` (resource.ts) refuses when the object is still missing after a write, and
         *   a flag is never missing, so that check could never fire here. PVE answers 200 with
         *   `{"data":null}` on calls that did nothing, and this PUT's documented return IS null,
         *   so the status code carries no evidence at all — only a read-back does.
         * ⚠️ THE PER-FLAG PUT IS SYNCHRONOUS (`$rados->mon_command` inline, MEASURED in Ceph.pm),
         *   which is what makes this check fair rather than a race against a worker task. If it
         *   ever fires spuriously the honest fix is to look at the mon, not to delete the guard.
         * ⛔ `formToSend` IS WHAT MAKES ADOPTING AN ALREADY-MATCHING FLAG FREE. Alchemy's
         *   `adopted` action reaches `reconcile` exactly like `update` does (resource.ts's own ⛔
         *   on this), so without this guard adopting a flag that already reads correctly would
         *   still fire a PUT — pointless against ceph, and update-guard.ts's header has the
         *   incident where the equivalent gap on CephPool forked an unnecessary worker.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* readClusterCephFlag(news);
          const form = formToSend(matches, live, news, updateForm(news));
          if (form !== undefined) {
            yield* guardWrite(CEPH_FLAG_UPDATE, updateForm(news), false);
            yield* writeClusterCephFlag(news);
          }
          const after = yield* readClusterCephFlag(news);
          if (after.value !== news.value) {
            return yield* Effect.die(
              new Error(
                `cluster/ceph/flags/${news.flag}: the PUT returned no error but ceph still ` +
                  `reports the flag ${after.value ? 'set' : 'clear'} rather than ` +
                  `${news.value ? 'set' : 'clear'}. This endpoint's success is documented as a ` +
                  'null body, so the status code proves nothing -- check `ceph osd dump | ' +
                  'head -1` and the cluster log. `pause` in particular is two ceph flags read ' +
                  'as one; see the header.',
              ),
            );
          }
          return after;
        }),
      }),
    ),
  );
