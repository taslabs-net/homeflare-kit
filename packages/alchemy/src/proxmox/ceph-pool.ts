/**
 * `Proxmox.CephPool` — a Ceph RADOS pool, declared. The richest Ceph family and the one a stack is
 * most likely to reach for, because every RBD disk in the cluster lives inside one.
 *
 * ⛔ IT DOES NOT USE `pveHandlers`, AND THE REASON IS MEASURED RATHER THAN STYLISTIC: THE READ AND
 *   THE WRITES SIT AT DIFFERENT PATHS. `GET /nodes/{node}/ceph/pool/{name}` is `poolindex` and
 *   answers `[{"name":"status"}]` — an INDEX OF CHILDREN, not the pool. The pool is one level
 *   further down, at `.../status` (`getpool`), which accepts no PUT and no DELETE. Every handler
 *   below is hand-written for that reason, on `client.ts` and now on distilled alike — acl.ts is
 *   the precedent for hand-writing over the factory.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()` ONTO `@distilled.cloud/proxmox`'s typed
 *   `nodes.getNodeCephPoolStatus`/`createNodeCephPool`/`putNodeCephPool`/`deleteNodeCephPool`/
 *   `listNodeCephPool` (2026-09-24, decision 43's walk-down, 2c). `distilled-pve.ts`'s `runPve`
 *   replaces `pve()`; `readPoolStatus` (ceph-pool-wire.ts) keeps the SAME single-fold shape this
 *   family always had — see that file's own header for why this migration does not also add the
 *   newer dual-path pattern `Proxmox.NodeNetwork` carries.
 *
 * ⛔ A CREATE FIRED AT A POOL THAT ALREADY EXISTS IS NOT A NO-OP, IT IS A PG MERGE — the second ⛔
 *   in ceph-pool-form.ts has the evidence, and `confirmAbsent` below is the guard that stops it.
 *
 * ⛔ EVERY WRITE HERE IS A FORKED WORKER. createpool, setpool and destroypool each return a UPID
 *   string, so HTTP 200 means "the task started" — an immediate read-back can see a pool that does
 *   not exist yet, or values that have not landed. `settle` waits for the cluster to agree.
 *
 * ⛔ THE FOUR POOLS ON C1 INCLUDE CEPH'S OWN, AND NONE OF THEM MAY BE ADOPTED. Measured
 *   2026-09-13: `.mgr` (application `mgr`, created and owned by the manager daemons),
 *   `cephfs-c1_data` and `cephfs-c1_metadata` (the two halves of the `cephfs-c1` filesystem —
 *   destroying either destroys the filesystem), and `rbd-c1`, the rbd pool the guests sit on.
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
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import {
  type CephPoolAttributes,
  type CephPoolProps,
  createBody,
  hint,
  object,
  same,
  updateBody,
} from './ceph-pool-form.ts';
import { confirmAbsent, settle } from './ceph-pool-settle.ts';
import {
  CEPH_POOL_CREATE,
  CEPH_POOL_UPDATE,
  readPoolStatus,
  toDistilledCreate,
  toDistilledUpdate,
} from './ceph-pool-wire.ts';
import { guardWrite } from './distilled-guard.ts';
import { runPve } from './distilled-pve.ts';
import { type PveRequirements } from './resource.ts';
import { formToSend } from './update-guard.ts';

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

/**
 * ⛔ DECLARING WHAT IS LIVE MUST PLAN noop, AND EVERY OMISSION HERE IS WHY. Out, each with its
 *   reason on the prop it belongs to: `pg_num` (the autoscaler rewrites it), `application` (the
 *   write only ever ADDS to a list), `target_size_ratio` (float equality), `id`, `applications`
 *   and the three `no*` flags (PVE returns them and accepts none of them on write), `node` and
 *   `name` (the address the read was made at — true by construction, never a diff). In, and each
 *   measured to round-trip unchanged against C1's four pools on 2026-09-13: size 3, min_size 2,
 *   pg_autoscale_mode `on`, crush_rule `replicated_rule`, pg_num_min where it is set (16 on
 *   cephfs-c1_metadata, absent on rbd-c1), target_size in bytes — and each of the last two
 *   through `hint`, which drops a declared zero for the reason given on it.
 */
const matches = (attributes: CephPoolAttributes, props: CephPoolProps) =>
  same(props.size, attributes.size, attributes.nosizechange) &&
  same(props.min_size, attributes.min_size, attributes.nosizechange) &&
  same(props.pg_autoscale_mode, attributes.pg_autoscale_mode) &&
  same(hint(props.pg_num_min), attributes.pg_num_min, attributes.nopgchange) &&
  same(props.crush_rule, attributes.crush_rule, attributes.crush_rule === '') &&
  same(hint(props.target_size), attributes.target_size);

export const ProxmoxCephPoolProvider = () =>
  Provider.effect(
    ProxmoxCephPool,
    Effect.succeed(
      ProxmoxCephPool.Provider.of({
        /** ⛔ Empty, and here it is what keeps `.mgr` and the two cephfs pools out — see the header. */
        list: () => Effect.succeed([]),
        read: ({ olds }) => readPoolStatus(olds),
        /**
         * ★ HAND-WRITTEN, matching the pre-migration `ops.diff` shape exactly (resource.ts) — this
         *   family never used the factory's own `diff`/`reconcile` (only its `read`), and the
         *   factory itself cannot run a distilled operation, so both are inlined here now.
         */
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(CEPH_POOL_CREATE, createBody(news), output === undefined);
          yield* guardWrite(CEPH_POOL_UPDATE, updateBody(news), false);
          if (output === undefined) return undefined;
          const live = yield* readPoolStatus(news);
          if (live === undefined) {
            yield* guardWrite(CEPH_POOL_CREATE, createBody(news), true);
            return { action: 'update' } as const;
          }
          return matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),
        /**
         * ⚠️ NOT A GENERIC reconcile: it POSTs the moment a read comes back empty, and reads back
         *   once, immediately. Both are wrong for a family whose writes are forked workers and whose
         *   create is destructive against a pool that is already there.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* readPoolStatus(news);
          let upid: string | undefined;
          if (live === undefined) {
            // ⛔ THE GUARD A GENERIC reconcile WOULD HAVE RUN, RESTORED. This handler replaces it
            //   wholesale, so without these two calls an ADOPTED pool — whose diff answer Alchemy
            //   discards — would reach the cluster with nothing having checked its body.
            yield* guardWrite(CEPH_POOL_CREATE, createBody(news), true);
            yield* confirmAbsent(news, object(news));
            upid = yield* runPve(
              news.target,
              'provision',
              true,
              nodes.createNodeCephPool(toDistilledCreate(news)),
            );
          } else {
            /**
             * ⛔ ONLY WHEN `matches` IS FALSE. This PUT used to fire whenever the pool existed, so
             *   adopting a pool that already matched — Plan.ts forces reconcile after the probe —
             *   sent `setpool` and forked a worker on the live cluster. PVE skipping the unchanged
             *   settings (ceph-pool-form.ts) made it harmless to Ceph, not free: it is still a
             *   provision-lease write and a task in the cluster's list. update-guard.ts has the rest.
             */
            const form = formToSend(matches, live, news, updateBody(news));
            if (form !== undefined) {
              yield* guardWrite(CEPH_POOL_UPDATE, updateBody(news), false);
              upid = yield* runPve(
                news.target,
                'provision',
                true,
                nodes.putNodeCephPool(toDistilledUpdate(news)),
              );
            }
          }
          const after = yield* settle(
            news,
            readPoolStatus,
            (row) => row !== undefined && matches(row, news),
          );
          if (after === undefined || !matches(after, news)) {
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
         *   `mon_allow_pool_delete` false fail once the call has already returned. MEASURED on C1
         *   2026-09-13: the config-db value is false while the running mons report true, i.e. it is
         *   set in ceph.conf and the two sources disagree by design.
         */
        delete: Effect.fn(function* ({ olds }) {
          yield* runPve(
            olds.target,
            'provision',
            true,
            nodes.deleteNodeCephPool({ name: olds.name, node: olds.node }),
          );
          const left = yield* settle(olds, readPoolStatus, (row) => row === undefined);
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
