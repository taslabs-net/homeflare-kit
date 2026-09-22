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
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { bool, flag } from './values.ts';

/**
 * PVE's eleven flags, spelled as `PVE::Ceph::Tools::get_possible_osd_flags` spells them.
 *
 * ⚠️ THE ENUM IS CLOSED AND A TYPO IS A 400, WHICH IS WHY THIS IS A UNION AND NOT `string`. Both
 *   the GET and the PUT declare `additionalProperties => 0` over exactly this list.
 * ⚠️ CEPH HAS FLAGS PVE DOES NOT MODEL, and four of them are always on. MEASURED on C1:
 *   `ceph osd dump` reports `flags sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit`.
 *   PVE reads that same string and answers only about its own eleven, so the others can neither
 *   leak in here nor be set from here — `noautoscale` and `nosnaptrim` included.
 *   ⛔ IF SOMEBODY LATER "IMPROVES" THE READ BY PARSING `osd dump` DIRECTLY, those four become
 *     permanently-set flags that nothing declares: a forever-diff on a brand new cluster.
 */
export type CephFlagName =
  | 'nobackfill'
  | 'nodeep-scrub'
  | 'nodown'
  | 'noin'
  | 'noout'
  | 'norebalance'
  | 'norecover'
  | 'noscrub'
  | 'notieragent'
  | 'noup'
  | 'pause';

export interface CephFlagProps extends WithTarget {
  /**
   * Which flag. PVE's primary key here, and the last segment of the path.
   *
   * ⚠️ EDITING IT IN PLACE ORPHANS THE OLD FLAG RATHER THAN MOVING ANYTHING. `diff` reads the NEW
   *   path and reconcile writes it, while the old flag keeps whatever this stack last put there.
   *   There is deliberately no replace override for it — acl.ts needs one because its `delete`
   *   removes a real grant, and `delete` here is inert by design, so a replace would do exactly
   *   what an update already does. Declare a second resource and set the old one to `value: false`
   *   rather than renaming this one.
   * ⛔ TWO RESOURCES DECLARING THE SAME FLAG ARE ONE CLUSTER OBJECT, and Alchemy sees two ids
   *   rather than a collision — the acl.ts hazard exactly. Disagreeing, they take turns winning
   *   and BOTH plan `update` for ever; agreeing, deleting either leaves the flag where the other
   *   put it. One declaration per flag per cluster.
   */
  flag: CephFlagName;
  /**
   * Set the flag (`true`) or clear it (`false`).
   *
   * ⛔ REQUIRED, WITH NO DEFAULT — see the second ⛔ in the header, which is the whole safety
   *   argument for this family. It is also the only field PVE accepts on this endpoint, and it is
   *   not optional in the schema either: omitting it from the form is a 400, not an untouched
   *   flag. (The BULK endpoint is the one where omission means "leave it alone"; this is not it.)
   */
  value: boolean;
}

export interface CephFlagAttributes {
  /**
   * ⚠️ REPORTED, NEVER COMPARED. It is the path key the read was made WITH, copied back out of
   *   props, so comparing it against props would be true by construction — the same reasoning
   *   acl.ts gives for the four identity fields it also declines to diff.
   */
  flag: CephFlagName;
  /** Whether ceph has the flag set right now. The only field `matches` looks at. */
  value: boolean;
}

export interface ProxmoxCephFlag extends Resource<
  'Proxmox.CephFlag',
  CephFlagProps,
  CephFlagAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxCephFlag = Resource<ProxmoxCephFlag>('Proxmox.CephFlag');

const handlers = pveHandlers<CephFlagProps, CephFlagAttributes>({
  /**
   * ⚠️ `live` IS A BARE BOOLEAN HERE, NOT AN OBJECT, AND IT IS HANDED TO `bool` WHOLE ON PURPOSE.
   *   `get_flag` returns perl `1` or `0` under a `type => 'boolean'` return schema, so the wire is
   *   `{"data":0}` or `{"data":false}` depending on how the REST layer renders it. `bool` accepts
   *   every one of those spellings, which is exactly why it is a shared coercion. The factory
   *   types this parameter `Record<string, unknown>` because every OTHER PVE read is an object;
   *   reaching for `live['value']` here would answer undefined on every plan and diff `false`
   *   forever against a set flag.
   *   ⚠️ THE SCALAR IS A MEASURED PROPERTY OF THIS PVE, NOT A PROMISE. A later version wrapping
   *     the answer in an object would make `bool` read a SET flag as false, and `value: false`
   *     would then plan `noop` over a live flag — silently. Re-measure
   *     `GET /cluster/ceph/flags/noout` after a major upgrade; cheaper than a second parse path.
   *
   * ⛔ IT NEVER ANSWERS undefined, WHICH MAKES THE CREATE BRANCH UNREACHABLE, AND ITS ERROR WILL
   *   MISLEAD YOU. All eleven flags always exist; there is nothing for "absent" to mean. So a POST
   *   to `collection` means the READ failed — an expired 300s lease, node-b down, or ceph simply not
   *   configured on the cluster (every one of these four handlers opens with
   *   `check_ceph_configured()`, which dies). Read the resulting "Method 'POST /cluster/ceph/flags'
   *   not implemented" as "the read failed" and go and look at the credential, not at ceph. Same
   *   shape as the unreachable POST in acl.ts, same advice.
   */
  attributes: (live, props) => ({ flag: props.flag, value: bool(live) }),
  collection: () => 'cluster/ceph/flags',
  /**
   * ⛔ UNREACHABLE — see the second ⛔ in `attributes`. It is written in the BULK endpoint's shape
   *   (the flag name is the parameter, not `value`) rather than left empty, because that is the
   *   only body `cluster/ceph/flags` has ever documented. Nothing sends it today.
   */
  createForm: (props) => ({ [props.flag]: flag(props.value) ?? '0' }),
  endpoint: { update: 'pve:PUT /cluster/ceph/flags/{flag}' }, // ⛔ No create: see above.
  /**
   * ⚠️ `value` IS THE ONLY THING COMPARED, AND THE LIST OF THINGS DELIBERATELY NOT COMPARED IS THE
   *   point of this resource. `flag` is props-derived (see `CephFlagAttributes`). `description`
   *   and `name` exist only on the bulk GET, which this file does not read, so neither can be
   *   compared by accident. Nothing PVE returns here is rewritten, re-ordered or re-typed by the
   *   cluster, because all PVE returns here is one boolean.
   *   ★ MEASURED: on C1, `GET /cluster/ceph/flags` answers value 0 for all eleven flags, so a
   *     declaration of `value: false` reads back false and plans `noop`.
   */
  matches: (attributes, props) => attributes.value === props.value,
  path: (props) => `cluster/ceph/flags/${props.flag}`,
  /**
   * ⚠️ ONLY `value` GOES IN THE BODY. `flag` is already bound by the path and the PUT declares
   *   `additionalProperties => 0`, so a second copy in the form could only disagree with the URL.
   * ⚠️ THE `?? '0'` IS UNREACHABLE, AND IS WRITTEN RATHER THAN CAST AWAY. `flag()` types its
   *   answer `string | undefined` because it serves OPTIONAL props, and `value` here is required,
   *   so the branch cannot be taken; a cast would claim a proof the type system has not made.
   */
  updateForm: (props) => ({ value: flag(props.value) ?? '0' }),
});

export const ProxmoxCephFlagProvider = () =>
  Provider.effect(
    ProxmoxCephFlag,
    Effect.succeed(
      ProxmoxCephFlag.Provider.of({
        /**
         * ⚠️ NOT THE ONE-LINE `Provider.of(handlers)` EVERY OTHER FILE HERE USES, AND THE TWO
         *   REASONS ARE BOTH acl.ts's. PVE implements no DELETE on this path, and the factory's
         *   read-back guard is dead whenever `attributes` cannot answer undefined. Unlike acl.ts
         *   this SPREADS the factory's handlers instead of retyping them, so `list`, `read` and
         *   `diff` cannot drift from the shared ones — only the two that genuinely differ are
         *   written out below.
         */
        ...handlers,
        /** ⛔ Inert, deliberately. The third ⛔ in the header is the whole argument; read it. */
        delete: () => Effect.void,
        /**
         * ⚠️ THE READ-BACK GUARD, RESTORED FOR A FAMILY WHOSE "ABSENT" DOES NOT EXIST.
         *   `ops.reconcile` refuses when the object is still missing after a write, and a flag is
         *   never missing, so that check can never fire here — exactly the hole acl.ts patches
         *   with `bound`. PVE answers 200 with `{"data":null}` on calls that did nothing, and this
         *   PUT's documented return IS null, so the status code carries no evidence at all.
         * ⚠️ THE PER-FLAG PUT IS SYNCHRONOUS (`$rados->mon_command` inline, MEASURED in Ceph.pm),
         *   which is what makes this check fair rather than a race against a worker task. If it
         *   ever fires spuriously the honest fix is to look at the mon, not to delete the guard.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const after = yield* handlers.reconcile({ news });
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
