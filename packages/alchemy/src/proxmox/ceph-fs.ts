/**
 * `Proxmox.CephFs` — a CephFS on the cluster's own Ceph. The filesystem a `cephfs` storage mounts.
 *
 * ⛔ A REPLACE OF THIS RESOURCE DESTROYS A LIVE FILESYSTEM, AND THERE IS NO PUT TO SAVE YOU FROM
 *   IT. MEASURED from the published schema on node-b, 2026-09-13: `/nodes/{node}/ceph/fs/{name}` has
 *   exactly two methods, POST and DELETE. A CephFS cannot be edited in place, so `updateForm` is
 *   left undefined and anything the factory can see as changed becomes a REPLACE — and Alchemy's
 *   replace is create-then-delete, where the delete is `destroyfs`: the entry leaves the MDS map,
 *   every mount on every node breaks, and whether the bytes survive rests on `remove-pools` alone.
 *   ★ WHICH IS THE WHOLE REASON `matches` COMPARES NOTHING. Read its ⛔ before adding a field to
 *     it. On every other resource in this package a forever-diff is an annoying plan line; on this
 *     one it is a live filesystem destroyed on every deploy, forever, because a background daemon
 *     moved a number nobody declared.
 *
 * ⛔ THERE IS NO SINGLE-OBJECT READ, WHICH INVERTS `path` AND `collection`. MEASURED on node-b:
 *     pvesh get /nodes/node-b/ceph/fs/cephfs-c1
 *       -> No 'get' handler defined for '/nodes/node-b/ceph/fs/cephfs-c1'
 *   `GET /nodes/{node}/ceph/fs` is a directory index and is the only read there is, so `path()`
 *   below returns the INDEX and `attributes` picks this filesystem out of the array client-side —
 *   the shape acl.ts uses for the one flat `GET /access/acl`. The POST goes to the `{name}` path,
 *   so `collection()` is the LONGER of the two strings, the mirror of metric-server.ts.
 *   ⚠️ AND THAT IS WHY EVERY HANDLER BELOW IS HAND-WRITTEN rather than taken from a factory. A
 *     factory `destroy` deletes the read path, which here is the index: `DELETE /nodes/{node}/
 *     ceph/fs` is not a route, so it would fail every destroy while the filesystem stayed exactly
 *     where it was. `reconcile` is hand-written for a second, independent reason — the forked
 *     worker — set out in ceph-fs-wire.ts. acl.ts is the precedent for a family that genuinely
 *     does not fit a shared shape.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()` ONTO `@distilled.cloud/proxmox`'s typed
 *   `nodes.listNodeCephFs`/`updateNodeCephFs` for the READ and the CREATE (2026-09-24, decision
 *   43's walk-down, 2c — ceph-fs-distilled.ts). `destroyFs` STAYS on `client.ts`, unmigrated:
 *   the SDK originally put `remove-pools`/`remove-storages` in a DELETE body, which PVE ignores.
 *   SDK PR #265 fixes that protocol gap; migrating `destroyFs` remains a separate change.
 *   The typed-read follow-up removes the catch-all fold from `readFs`: a failed index must
 *   fail read/diff/reconcile/delete, not report a missing filesystem or a successful destroy.
 *
 * ⛔ CREATING A CephFS CREATES TWO CEPH POOLS, AND A `Proxmox.CephPool` MUST NOT ALSO DECLARE THEM.
 *   `createfs` builds `<name>_data` and `<name>_metadata` itself and refuses outright if either
 *   exists ("ceph pools '…_data' and/or '…_metadata' already exist"). MEASURED on C1: the live
 *   `cephfs-c1` owns `cephfs-c1_data` (id 6) and `cephfs-c1_metadata` (id 7), both of which
 *   `GET /nodes/node-b/ceph/pool` lists like any other pool — and `/nodes/{node}/ceph/pool/{name}` DOES
 *   have GET, PUT and DELETE, so a pool resource would be a clean `pveHandlers` fit and would
 *   adopt them without noticing. Declaring both is double management of one object: whichever
 *   reconciles first wins, and the loser either fails its create or PUTs `size`/`pg_num` onto pools
 *   this resource believes it owns. Declare the filesystem here and leave its two pools alone.
 *
 * ⚠️ `add-storage` IS A SECOND SIDE EFFECT AND IT LANDS IN storage.cfg. Set, `createfs` also calls
 *   `PVE::API2::Storage::Config->create` with type `cephfs`, content `backup,iso,vztmpl` and
 *   `fs-name <name>`. MEASURED: /etc/pve/storage.cfg on node-b holds exactly that — `cephfs:
 *   cephfs-c1` / `content backup,vztmpl,iso` / `fs-name cephfs-c1`. So a `Proxmox.Storage`
 *   declaring `cephfs-c1` would be managing an entry this resource created. Declare ONE of them:
 *   either `add-storage` here and no storage resource, or `add-storage` off and a
 *   `Proxmox.Storage` that reads this resource's `name` attribute — which also gets the ordering
 *   right for free, because Alchemy orders by data flow.
 *
 * ⚠️ `node` IS A ROUTE, NOT IDENTITY, AND MUST NEVER BE DIFFED. A CephFS is cluster-wide; the node
 *   in the path only says which node PVE proxies the call to. MEASURED: `GET /nodes/node-b/ceph/fs`,
 *   `…/node-c/…` and `…/node-d/…` returned the byte-identical array. So changing `node` plans `noop`, and
 *   two resources naming the same `name` on different nodes are the SAME filesystem — the vmid
 *   hazard from lxc.ts, with a filesystem on the end of it instead of a container.
 *
 * ⚠️ PRIVILEGES: the read lane needs `Sys.Audit` OR `Datastore.Audit` on `/`, which an auditor
 *   role already holds — unlike storage.ts, nothing needs widening before the first plan. The
 *   write side is in ceph-fs-wire.ts beside the calls, and in docs/privileges.md with the rest.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { createFs, readFs } from './ceph-fs-distilled.ts';
import { CEPH_FS_CREATE, createForm, destroyFs, notCreated, notDestroyed } from './ceph-fs-wire.ts';
import { guardWrite } from './distilled-guard.ts';
import { type PveRequirements, type WithTarget } from './resource.ts';

export interface CephFsProps extends WithTarget {
  /** ⚠️ Which node answers the call, NOT which node holds the filesystem. See the header. */
  node: string;
  /**
   * The filesystem name, and the cluster-wide primary key. PVE's pattern is `^[^:/\s]+$`.
   * ⛔ CHANGING IT IS A REPLACE, WHICH DESTROYS THE OLD FILESYSTEM. `diff` says so explicitly
   *   below rather than letting the factory report a create-shaped `update` and orphan the old one.
   */
  name: string;
  /**
   * Placement groups for the backing data pool; the metadata pool gets a quarter of it, or 8 when
   * this is under 32. PVE's default is 128.
   *
   * ⛔ CREATE-TIME ONLY, UNREADABLE, AND OWNED BY THE AUTOSCALER FROM THE SECOND IT LANDS. It is
   *   never compared — see the ⛔ on `matches` — and this is not caution, it is measured. C1's
   *   `cephfs-c1` was created with the default 128 (the arithmetic proves it: `cephfs-c1_metadata`
   *   sits at 32, which is 128/4), and `cephfs-c1_data` reads pg_num 32 TODAY. The autoscaler moved
   *   it by a factor of four, and it is not finished: `pg_autoscale_mode` is `on` for every pool on
   *   this cluster and `cephfs-c1_metadata` already reports `pg_num_final: 16` against its live 32.
   */
  pg_num?: number;
  /**
   * Also write a `cephfs` storage entry for this filesystem. ⚠️ Create-time only and never read
   *   back — it is an ACTION, not a field. See the header for what it does to `Proxmox.Storage`.
   */
  'add-storage'?: boolean;
  /** ⛔ DELETE-TIME ONLY, AND IT ERASES THE DATA. Read the ⛔ on `destroyFs` before setting it. */
  'remove-pools'?: boolean;
  /**
   * Delete the pveceph-managed storage entries too. ⚠️ PVE refuses unless they are already
   *   disabled ("storage '…' is not disabled, make sure to disable and unmount the storage first"),
   *   so this fails the destroy rather than unmounting anything out from under a running guest.
   */
  'remove-storages'?: boolean;
}

/**
 * ⚠️ EVERY FIELD HERE IS REPORTED AND NONE IS COMPARED. They exist so a plan, and the state entry
 *   behind it, can say what the declaration actually points at — which pools hold the bytes.
 */
export interface CephFsAttributes {
  name: string;
  /** The first data pool. PVE keeps it for compatibility; `data_pools` is the real answer. */
  data_pool: string;
  /**
   * ⚠️ SORTED, AND IT IS A SET RATHER THAN A LIST. A CephFS can hold several data pools — added
   *   with `ceph fs add_data_pool`, which this resource has no way to express — and PVE reports
   *   them in the MDS map's own order. Sorting is what keeps this attribute stable across reads.
   */
  data_pools: string;
  metadata_pool: string;
  /**
   * ⚠️ AN INTEGER THAT NAMES SOMETHING WRITTEN AS A NAME, AND THEREFORE A CLASSIC FOREVER-DIFF IF
   *   IT EVER REACHED `matches`. PVE answers `metadata_pool_id: 7` while every write in this family
   *   spells a pool by name. It is here to be read, never to be compared. `-1` means absent: the
   *   field is optional in the schema and older PVE omits it.
   */
  metadata_pool_id: number;
}

export interface ProxmoxCephFs extends Resource<
  'Proxmox.CephFs',
  CephFsProps,
  CephFsAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a filesystem holding data cannot be rebuilt. See the ★ in resource.ts. */
export const ProxmoxCephFs = Resource<ProxmoxCephFs>('Proxmox.CephFs', {
  defaultRemovalPolicy: 'retain',
});

/**
 * ⛔ NOTHING IS COMPARED, AND THAT IS THE MOST DELIBERATE LINE IN THIS FILE. A CephFS has no
 *   readable, writable field: the index returns only the name and the pools behind it, and every
 *   prop this resource accepts is create-time or delete-time. So "present" IS "settled", and the
 *   only honest comparison is none at all.
 *   ⚠️ THE TEMPTING ADDITION IS `pg_num`, AND IT WOULD BE THE WORST BUG THIS PACKAGE HAS SHIPPED.
 *     It is not in the index at all, so it can only be read from the pool endpoint — where the
 *     autoscaler owns it. MEASURED on C1 today: created at 128, live at 32, with the metadata
 *     pool already scheduled down to 16. Compared, that is an eternal mismatch — and since there
 *     is no update path, treating this as a diff would plan a REPLACE. The plan would destroy and
 *     rebuild a live filesystem on every deploy, triggered by a daemon on its own schedule.
 *   ⚠️ `data_pools` AND `metadata_pool_id` ARE OUT FOR THE ORDINARY REASONS: a set PVE returns
 *     in its own order, and an integer id for something written as a name. `name` is out because
 *     it is the FILTER that produced these attributes, so comparing it is true by construction —
 *     an identity change is handled in `diff`, not here. `node` is out because it is a route.
 */
export const ProxmoxCephFsProvider = () =>
  Provider.effect(
    ProxmoxCephFs,
    Effect.succeed(
      ProxmoxCephFs.Provider.of({
        /**
         * ⛔ EMPTY, LIKE EVERY OTHER RESOURCE HERE. The index answers with every filesystem on the
         *   cluster, `cephfs-c1` included — the one holding this estate's ISOs and templates.
         *   Adopting it would put Alchemy one `destroy` away from it. Adoption stays explicit.
         */
        list: () => Effect.succeed([]),
        read: Effect.fn(function* ({ olds }) {
          return yield* readFs(olds);
        }),
        /**
         * ⛔ A CHANGED `name` IS A REPLACE, AND NOTHING ELSE CAN SAY SO. Left undetected, a rename
         *   reads the NEW name, finds nothing, and plans the drift-shaped `update` this family uses
         *   for "Alchemy has state, the cluster does not" — so reconcile would build the new
         *   filesystem and LEAVE THE OLD ONE, with its pools, its storage entry and its bytes,
         *   owned by nobody and invisible in every later plan.
         *   ⛔ SAYING `replace` IS HONEST, AND IT IS ALSO WHAT MAKES A TYPO EXPENSIVE. Alchemy
         *     creates first and deletes second, so the old filesystem is destroyed AFTER the new
         *     one exists — with `remove-pools` unset the bytes are stranded rather than erased, and
         *     that default is the only thing between a mis-typed rename and an unrecoverable one.
         *     ⚠️ `node` is NOT part of identity and must never join this comparison.
         */
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(CEPH_FS_CREATE, createForm(news), output === undefined);
          if (output !== undefined && news.name !== output.name) {
            return { action: 'replace' } as const;
          }
          if (output === undefined) return undefined;
          const live = yield* readFs(news);
          if (live === undefined) {
            yield* guardWrite(CEPH_FS_CREATE, createForm(news), true);
            return { action: 'update' } as const;
          }
          // ⛔ SEE THE ⛔ ABOVE `ProxmoxCephFsProvider`: NOTHING ELSE IS COMPARED. Present is settled.
          return { action: 'noop' } as const;
        }),
        /**
         * ⚠️ THE READ-BACK IS KEPT EVEN THOUGH `createFs` ALREADY WAITED OUT THE TASK. Waiting
         *   proves the task ENDED, reading proves the filesystem EXISTS, and PVE has shipped tasks
         *   that end OK having done nothing.
         * ⚠️ AN EXISTING FILESYSTEM IS RETURNED UNTOUCHED. There is no update call to make, so the
         *   only write this handler can perform is a create; `diff` has already decided that a
         *   real change is a replace, and Alchemy calls delete for the old generation itself.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* readFs(news);
          if (live !== undefined) return live;
          yield* createFs(news);
          const after = yield* readFs(news);
          if (after === undefined) return yield* Effect.die(notCreated(news));
          return after;
        }),
        /**
         * ⛔ THE READ-BACK IS WHAT TURNS "the task said OK" INTO "it is actually gone": `destroyfs`
         *   refuses while a non-disabled `cephfs` storage still references the filesystem, and that
         *   refusal must fail the destroy rather than letting Alchemy drop the state entry for a
         *   live object. `destroyFs` itself stays on `client.ts` — ceph-fs-wire.ts's own header has
         *   the measured, protocol-level reason.
         */
        delete: Effect.fn(function* ({ olds }) {
          /**
           * ⚠️ A FILESYSTEM SOMEBODY ALREADY REMOVED BY HAND IS NOT AN ERROR. `destroyfs` dies
           *   synchronously with "no such cephfs", which would fail every destroy of a stack whose
           *   filesystem was cleaned up outside Alchemy and leave the state entry unremovable
           *   without editing the store. The original catch-all read fold could also report
           *   success after a 403 without deleting anything, and could defeat read-back after a
           *   write. `readFs` now propagates those failures: only a successful index with no
           *   matching row may short-circuit this delete or confirm the filesystem is gone.
           */
          if ((yield* readFs(olds)) === undefined) return;
          yield* destroyFs(olds);
          const after = yield* readFs(olds);
          if (after !== undefined) return yield* Effect.die(notDestroyed(olds));
        }),
      }),
    ),
  );
