/**
 * `Proxmox.CephPool` — a Ceph RADOS pool, declared. The richest Ceph family and the one a stack is
 * most likely to reach for, because every RBD disk in the cluster lives inside one.
 *
 * ⛔ IT DOES NOT USE `pveHandlers`, AND THE REASON IS MEASURED RATHER THAN STYLISTIC: THE READ AND
 *   THE WRITES SIT AT DIFFERENT PATHS. `GET /nodes/{node}/ceph/pool/{name}` is `poolindex` and
 *   answers `[{"name":"status"}]` — an INDEX OF CHILDREN, not the pool. The pool is one level
 *   further down, at `.../status` (`getpool`), which accepts no PUT and no DELETE. A `PveSpec`
 *   carries ONE `path` for read, update and delete, so this family cannot be spelled in it. `path`
 *   below is therefore the READ path and nothing else consumes it: `ops.reconcile` and
 *   `ops.destroy` go unused and the two write handlers name their own path. acl.ts is the
 *   precedent for hand-writing the five handlers over `pveOperations`.
 *
 * ⛔ A CREATE FIRED AT A POOL THAT ALREADY EXISTS IS NOT A NO-OP, IT IS A PG MERGE — the second ⛔
 *   in ceph-pool-form.ts has the evidence, and `confirmAbsent` below is the guard that stops it.
 *
 * ⛔ EVERY WRITE HERE IS A FORKED WORKER. createpool, setpool and destroypool each return a UPID
 *   string, so HTTP 200 means "the task started" — an immediate read-back can see a pool that does
 *   not exist yet, or values that have not landed. `settle` waits for the cluster to agree.
 *
 * ⛔ THE FOUR POOLS ON TB4 INCLUDE CEPH'S OWN, AND NONE OF THEM MAY BE ADOPTED. Measured
 *   2026-09-13: `.mgr` (application `mgr`, created and owned by the manager daemons),
 *   `cephfs-tb4_data` and `cephfs-tb4_metadata` (the two halves of the `cephfs-tb4` filesystem —
 *   destroying either destroys the filesystem), and `cephtb4`, the rbd pool the guests sit on.
 *   `list` answers empty like every resource in this package, so adoption stays an explicit act;
 *   the `applications` attribute is reported so that a plan SHOWS which of those a declaration hit.
 *
 * ⚠️ DELETING A POOL DESTROYS EVERY OBJECT IN IT AND CEPH DOES NOT ASK TWICE. Neither `force` nor
 *   `remove_storages` is ever sent, so PVE's refusal while a storage on the pool still lists RBD
 *   images is left standing. That refusal does NOT cover an RBD user outside storage.cfg.
 *
 * ⚠️ PRIVILEGES, AND THE WRITE LANE IS A BIG ASK. Read is `Sys.Audit` OR `Datastore.Audit` on `/`
 *   (PVEAuditor holds both, so the mount's `read` role covers read, diff and the guard). Create,
 *   update and delete each check `Sys.Modify` on `/` — there is no `/ceph` object to scope to, so
 *   granting it also buys datacenter options and every other cluster-wide write. Widen
 *   deliberately, the way `Pool.Allocate` was widened for `Proxmox.Pool`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import {
  type CephPoolAttributes,
  type CephPoolProps,
  UNSET,
  applications,
  collection,
  createBody,
  hint,
  object,
  same,
  updateBody,
} from './ceph-pool-form.ts';
import { confirmAbsent, settle } from './ceph-pool-settle.ts';
import { pve } from './client.ts';
import { type PveRequirements, type PveSpec, pveOperations } from './resource.ts';
import { formToSend } from './update-guard.ts';
import { bool, int, num, text } from './values.ts';

export type { CephPoolAttributes, CephPoolProps };

export interface ProxmoxCephPool extends Resource<
  'Proxmox.CephPool',
  CephPoolProps,
  CephPoolAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a pool holding objects cannot be rebuilt. See the ★ in resource.ts. */
export const ProxmoxCephPool = Resource<ProxmoxCephPool>('Proxmox.CephPool', {
  defaultRemovalPolicy: 'retain',
});

const spec: PveSpec<CephPoolProps, CephPoolAttributes> = {
  /**
   * ⛔ `name` IS THE PRESENCE TEST, AND IT IS ALSO HOW THE INDEX TRAP FAILS SAFE. Pointed at
   *   `.../pool/{name}` rather than `.../status`, the factory would hand this function an ARRAY:
   *   every field would read absent and the plan would report an update no write can satisfy.
   *   `getpool` always returns `name` for a real pool, so that shape answers "not there" instead
   *   — and "not there" cannot reach a create unless `confirmAbsent` agrees.
   */
  attributes: (live, props) => {
    if (typeof live['name'] !== 'string') return undefined;
    return {
      applications: applications(live['application_list']),
      crush_rule: text(live['crush_rule']),
      id: int(live['id'], UNSET),
      min_size: int(live['min_size'], UNSET),
      name: props.name,
      node: props.node,
      nodelete: bool(live['nodelete']),
      nopgchange: bool(live['nopgchange']),
      nosizechange: bool(live['nosizechange']),
      pg_autoscale_mode: text(live['pg_autoscale_mode']),
      pg_num: int(live['pg_num'], UNSET),
      pg_num_min: int(live['pg_num_min'], UNSET),
      size: int(live['size'], UNSET),
      target_size: int(live['target_size'], UNSET),
      target_size_ratio: num(live['target_size_ratio'], UNSET),
    };
  },
  collection,
  createForm: createBody,
  /**
   * ⛔ DECLARING WHAT IS LIVE MUST PLAN noop, AND EVERY OMISSION HERE IS WHY. Out, each with its
   *   reason on the prop it belongs to: `pg_num` (the autoscaler rewrites it), `application` (the
   *   write only ever ADDS to a list), `target_size_ratio` (float equality), `id`, `applications`
   *   and the three `no*` flags (PVE returns them and accepts none of them on write), `node` and
   *   `name` (the address the read was made at — true by construction, never a diff). In, and each
   *   measured to round-trip unchanged against TB4's four pools on 2026-09-13: size 3, min_size 2,
   *   pg_autoscale_mode `on`, crush_rule `replicated_rule`, pg_num_min where it is set (16 on
   *   cephfs-tb4_metadata, absent on cephtb4), target_size in bytes — and each of the last two
   *   through `hint`, which drops a declared zero for the reason given on it.
   */
  matches: (attributes, props) =>
    same(props.size, attributes.size, attributes.nosizechange) &&
    same(props.min_size, attributes.min_size, attributes.nosizechange) &&
    same(props.pg_autoscale_mode, attributes.pg_autoscale_mode) &&
    same(hint(props.pg_num_min), attributes.pg_num_min, attributes.nopgchange) &&
    same(props.crush_rule, attributes.crush_rule, attributes.crush_rule === '') &&
    same(hint(props.target_size), attributes.target_size),
  /**
   * ⛔ THE READ PATH, AND ONLY THE READ PATH.
   * ⚠️ `?verbose=1` IS WHAT MAKES `applications` VISIBLE AT ALL — without it PVE omits the tags
   *   entirely (MEASURED across all four pools; there is no `application` key either way, only
   *   `application_list`, and only when verbose). The cost is that verbose adds two unguarded mon
   *   commands, `df` and `osd pool application get`, so a degraded mgr can fail the read. That is
   *   safe here rather than merely unlucky: a failed read is "absent", and "absent" cannot reach a
   *   create unless `confirmAbsent` agrees.
   */
  path: (props) => `${object(props)}/status?verbose=1`,
  updateForm: updateBody,
};

const ops = pveOperations(spec);

export const ProxmoxCephPoolProvider = () =>
  Provider.effect(
    ProxmoxCephPool,
    Effect.succeed(
      ProxmoxCephPool.Provider.of({
        /** ⛔ Empty, and here it is what keeps `.mgr` and the two cephfs pools out — see the header. */
        list: () => Effect.succeed([]),
        read: ({ olds }) => ops.read(olds),
        diff: ({ news, output }) => ops.diff(news, output),
        /**
         * ⚠️ NOT `ops.reconcile`: it POSTs the moment a read comes back empty, and reads back once,
         *   immediately. Both are wrong for a family whose writes are forked workers and whose
         *   create is destructive against a pool that is already there.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* ops.read(news);
          let upid: string | undefined;
          if (live === undefined) {
            yield* confirmAbsent(news, spec.collection(news), object(news));
            upid = yield* pve<string>(
              news.target,
              'provision',
              'POST',
              collection(news),
              createBody(news),
            );
          } else {
            /**
             * ⛔ ONLY WHEN `matches` IS FALSE. This PUT used to fire whenever the pool existed, so
             *   adopting a pool that already matched — Plan.ts forces reconcile after the probe —
             *   sent `setpool` and forked a worker on the live cluster. PVE skipping the unchanged
             *   settings (ceph-pool-form.ts) made it harmless to Ceph, not free: it is still a
             *   provision-lease write and a task in the cluster's list. update-guard.ts has the rest.
             */
            const form = formToSend(spec.matches, live, news, updateBody(news));
            if (form !== undefined) {
              upid = yield* pve<string>(news.target, 'provision', 'PUT', object(news), form);
            }
          }
          const after = yield* settle(
            news,
            ops.read,
            (row) => row !== undefined && spec.matches(row, news),
          );
          if (after === undefined || !spec.matches(after, news)) {
            return yield* Effect.die(
              new Error(
                `${object(news)}: the write returned no error but the pool still does not match ` +
                  `the declaration after 60s. PVE answered with task ${upid ?? '(none)'} -- read ` +
                  'its log with `pvesh get /nodes/<node>/tasks/<upid>/log` to see what Ceph ' +
                  'refused.',
              ),
            );
          }
          return after;
        }),
        /**
         * ⛔ THIS DESTROYS EVERY OBJECT IN THE POOL. No `force`, so PVE's own check — it refuses
         *   while a PVE storage on this pool still lists RBD images — is left standing; and no
         *   `remove_storages`, so a storage.cfg section pointing here survives and stays somebody's
         *   to remove deliberately.
         * ⚠️ AND THE REFUSAL CAN ARRIVE AFTER THE RESPONSE, WHICH IS WHY THIS WAITS. The DELETE
         *   forks a worker and answers 200 with a UPID, so mons running with
         *   `mon_allow_pool_delete` false fail once the call has already returned. MEASURED on TB4
         *   2026-09-13: the config-db value is false while the running mons report true, i.e. it is
         *   set in ceph.conf and the two sources disagree by design.
         */
        delete: Effect.fn(function* ({ olds }) {
          yield* pve<string>(olds.target, 'provision', 'DELETE', object(olds));
          const left = yield* settle(olds, ops.read, (row) => row === undefined);
          if (left !== undefined) {
            return yield* Effect.die(
              new Error(
                `${object(olds)}: the DELETE returned no error but the pool is still there after ` +
                  '60s. Either a storage on it still holds RBD images, or the mons are running ' +
                  'with mon_allow_pool_delete false.',
              ),
            );
          }
        }),
      }),
    ),
  );
