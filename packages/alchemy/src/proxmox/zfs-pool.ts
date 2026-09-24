/**
 * `Proxmox.ZfsPool` — a zpool built on one node's physical disks, declared.
 *
 * ⛔ A CREATE HERE WIPES THE DISKS IT IS GIVEN AND THERE IS NO UNDO. `POST /nodes/{node}/disks/zfs`
 *   runs `zpool create` on the block devices named in `devices`; whatever was on them is gone the
 *   moment the worker runs. Every other decision in this file follows from that one sentence, and
 *   each of them is written out below rather than left to be inferred.
 *
 * ⛔ ★ CORRECTED 2026-09-23 — THIS PARAGRAPH PREVIOUSLY SAID "DESTROY IS REFUSED" AND "`delete`
 *   MAKES NO API CALL". THAT WAS FALSE: MEASURED against this file's own `handlers.delete` below,
 *   which calls `destroyPool`, which sends `DELETE /nodes/{node}/disks/zfs/{name}` — the node's
 *   own source forks `zfsremove`, which runs `zpool destroy <name>` unconditionally, and with
 *   `cleanup-disks` then calls `wipe_blockdev` on every member (neither flag is offered as a prop,
 *   because there is no call here for them to reach). `delete` is FULLY IMPLEMENTED, per S14
 *   (alchemy-provider-standard): a `delete` that silently does nothing lies to whoever reads the
 *   plan. What actually keeps an ordinary removed declaration from reaching it is
 *   `defaultRemovalPolicy: 'retain'` below — Alchemy SKIPS `provider.delete` entirely for an
 *   orphaned or destroyed resource under `retain`, so the state row drops and the zpool and its
 *   data are left exactly where they are. The asymmetry is still the whole argument: an ORPHANED
 *   pool is recoverable (declare it again, or destroy it by hand once a human has looked at which
 *   disks are in it), a DESTROYED pool is not — which is why `retain` is the default rather than a
 *   documented caution, and why `delete` runs only for a caller who opts in by name with
 *   `.pipe(RemovalPolicy.destroy())`. See the ★ on `defaultRemovalPolicy` in resource-spec.ts, and
 *   zfs-pool-adopt.test.ts's mutation row, which pins exactly one DELETE reaching the fake cluster.
 *
 * ⛔ THERE IS NO PUT ON THIS FAMILY AT ALL. MEASURED from the cluster's own published schema
 *   (`/usr/share/pve-docs/api-viewer/apidoc.js`, read on node-b 2026-09-13): `/nodes/{node}/disks/zfs`
 *   has GET and POST, `/nodes/{node}/disks/zfs/{name}` has GET and DELETE, and that is the whole
 *   surface — CONFIRMED again in `@distilled.cloud/proxmox`'s generated `nodes.ts`, which declares
 *   no `putNodeDiskZfs` at all. So `matches` (zfs-pool-wire.ts) always answers `true`: there is
 *   nothing to plan a replace over, and the family's one write is the create below.
 *
 * ⛔ NOT ONE CREATE PARAMETER COMES BACK ON READ, SO `matches` COMPARES NOTHING. MEASURED against
 *   the live cluster: `GET /nodes/n2/disks/zfs/rpool` answers exactly
 *   `{action?, children, errors, name, scan?, state, status?}` — no `ashift`, no `compression`, no
 *   `raidlevel`, no `devices`, no `add_storage`. Every create parameter is write-only. There is
 *   therefore no field a declaration and a live pool can both be asked about, and a `matches` that
 *   invented one would plan a replace — i.e. a `zpool destroy` — over a difference it could never
 *   verify in the first place.
 *
 * ⚠️ AND WHAT THE INDEX RETURNS IS LIVE TELEMETRY, NOT CONFIGURATION. `GET /nodes/node-b/disks/zfs`
 *   gives `alloc`, `free`, `frag`, `dedup`, `size`, `health`. MEASURED: two reads of node-b seconds
 *   apart returned `alloc` 14474944512 then 14472740864 — it moves on its own, with no declaration
 *   anywhere near it. `scan` in the detail read moves the same way (it carries the last scrub), and
 *   `status`/`action` appear and vanish as ZFS feature flags and faults come and go. None of them
 *   is compared, and the three churning strings are kept out of the state store entirely rather
 *   than rewriting this resource's row every time somebody writes a file.
 *
 * ⛔ A MISSING POOL IS A 500, NOT A 404 — MEASURED against the live cluster (TB4 n2, 2026-09-24,
 *   read-role, read-only probe): `GET /nodes/n2/disks/zfs/hf-measure-nonexistent-pool` answers a
 *   generic shelled-out command failure at HTTP 500, the same shape as every other family this
 *   package has migrated. `zfs-pool-wire.ts` carries the same dual-path read PR 239/243
 *   established: `readPoolOrFail` (non-folding, used by `diff`) and `readPool` (folding, used by
 *   `createPool`'s settle-poll and by `read`/`reconcile`).
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()`/`pveOperations` ONTO `@distilled.cloud/proxmox`'s
 *   typed `nodes.getNodeDiskZfs`/`createNodeDiskZfs`/`deleteNodeDiskZfs` (2026-09-24, decision
 *   43's proxmox walk-down, nodes/storage sub-area). `distilled-pve.ts`'s `runPve` replaces
 *   `pve()`; the cries-wolf fix is wired the same way as every other migrated family. `reconcile`
 *   and `delete` are still hand-written (never the factory) for the SAME two reasons as before the
 *   migration — the forked-worker settle-poll, and a DELETE that destroys data — now calling
 *   `zfs-pool-form.ts`'s `createPool`/`destroyPool` directly instead of through `pveHandlers`.
 *
 * ⚠️ PRIVILEGES, FROM THE SCHEMA. Read and diff need `Sys.Audit` on `/` — both GETs check it.
 *   Reconcile needs `Sys.Modify` on `/` for the POST. `Datastore.Allocate` on `/storage` is NOT
 *   needed, because `add_storage` is not offered — see the ⛔ on `ZfsPoolProps`.
 *   ★ CORRECTED 2026-09-23, ALONGSIDE THE HEADER ABOVE: `delete` needs `Sys.Modify` on `/` too,
 *   for the DELETE it now sends under `.pipe(RemovalPolicy.destroy())` — the whole `disks/zfs`
 *   family checks it, not only the POST. MEASURED the same day as the rest of this paragraph:
 *   `ceph-osd.ts`'s own privilege comparison names `disks/zfs` as one of the sibling families
 *   whose write verbs DO carry a `Sys.Modify` check, unlike `ceph/osd`'s create and delete, which
 *   carry no permissions block at all and 403 for any identity but `root@pam`.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { asForm } from './distilled-guard.ts';
import { guardForm } from './constraint-guard.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { UNREADABLE, unreadableWarning } from './unreadable-read.ts';
import { dropUnreadable, readPool, readPoolOrFail } from './zfs-pool-wire.ts';
import type { ZfsPoolAttributes } from './zfs-pool-wire.ts';
import { createForm, createPool, destroyPool, zfsPoolCreateEndpoint } from './zfs-pool-form.ts';
import type { ZfsCompression, ZfsRaidLevel } from './zfs-pool-form.ts';

export type { ZfsPoolAttributes } from './zfs-pool-wire.ts';
export type { ZfsCompression, ZfsRaidLevel } from './zfs-pool-form.ts';

/**
 * ⛔ THERE IS NO `add_storage`, `cleanup-config` OR `cleanup-disks` PROP, AND THAT IS NOT AN
 *   OVERSIGHT. The last two belong to the DELETE this resource refuses to make. `add_storage=1`
 *   would have the POST build a `Proxmox.Storage`-shaped object this resource does not own, cannot
 *   see on any later read, and cannot remove — invisible to every diff forever, and a collision
 *   waiting for the day somebody also declares the storage properly. Declare a `Proxmox.Storage`
 *   with `type: 'zfspool'` and `locator: { pool: <this pool's name> }` instead, reading the `name`
 *   attribute below so Alchemy orders the storage after the pool.
 */
export interface ZfsPoolProps extends WithTarget {
  /**
   * ⛔ A ZPOOL IS NODE-LOCAL AND THIS IS HALF ITS IDENTITY. Changing it moves nothing: `path` then
   *   points at a different node, the read answers absent, and reconcile tries to CREATE the pool
   *   over there — on whatever `/dev/...` happens to answer to those names on that machine.
   *   Declare a separate resource per node instead.
   */
  node: string;
  /** The zpool name, and PVE's key for it on this node. ⚠️ Changing it creates a SECOND pool. */
  name: string;
  /**
   * The block devices to build it on.
   *
   * ⛔ NAME THEM BY `/dev/disk/by-id/...`, NOT `/dev/sdb`. Kernel names are not stable across
   *   reboots; a by-id link is. MEASURED in the node's source: PVE resolves what it is handed to a
   *   by-id link only AFTER it has decided the device is free, so a stale `/dev/sdb` in a stack
   *   file is checked against, and then wiped, whichever disk currently answers to that name.
   * ⚠️ ORDER IS MEANING FOR `raid10` AND IS PRESERVED — PVE walks the list two at a time and makes
   *   each pair a mirror. This is why the form uses a plain join and NOT `csv()` from values.ts:
   *   `csv` sorts, and sorting this list silently re-pairs the mirrors into a different pool.
   * ⚠️ PVE's only guard is `assert_disk_unused`, i.e. its own `disk_is_used` over the same `used`
   *   column the Disks view shows. A blank disk it considers free is wiped with no confirmation.
   *
   * ⛔ OPTIONAL SINCE DECISION 9 (2026-09-23), AND OMITTING IT MEANS SOMETHING SPECIFIC: leaving
   *   both this and `raidlevel` undeclared declares an ADOPT-ONLY pool — one this resource may
   *   read and report but never build. That is the only shape available for a pool PVE's own POST
   *   schema cannot fully describe, such as n1's `speed`, whose layout is a stripe and whose
   *   `raidlevel` enum (above) has no stripe to declare. `createForm` (zfs-pool-form.ts) omits
   *   both keys when they are absent, and `createPool` refuses before any POST if the pool it
   *   would need to build is not already there — an adopt-only declaration never creates. Declare
   *   both fields together for a pool this resource should build from scratch; declaring only one
   *   of the two is refused the same way, since PVE's POST requires both.
   */
  devices?: readonly string[];
  raidlevel?: ZfsRaidLevel;
  /**
   * Sector size exponent, 9–16, PVE default 12.
   *
   * ⛔ WRITE-ONLY AND IMMUTABLE FOR THE LIFE OF THE POOL. It is consumed by `zpool create -o
   *   ashift=` and never returned by any read on this family, so changing it later plans as `noop`
   *   and changes nothing. A different ashift means destroying and rebuilding the pool, by hand,
   *   with the data moved off first.
   */
  ashift?: number;
  /**
   * ⚠️ Write-only in the same way as `ashift`: applied by `zfs set compression=` at create time and
   *   never read back, so a later change plans `noop`. Change it with `zfs set` on the node.
   */
  compression?: ZfsCompression;
  /**
   * `data=<integer>,spares=<integer>`. ⚠️ THE WIRE NAME IS KEPT, HYPHEN AND ALL, for the reason
   * `storage.ts` keeps `prune-backups`: a second spelling is a second name for one thing.
   * ⚠️ PVE refuses it outright unless `raidlevel` is one of the `draid*` levels.
   */
  'draid-config'?: string;
}

export interface ProxmoxZfsPool extends Resource<
  'Proxmox.ZfsPool',
  ZfsPoolProps,
  ZfsPoolAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a pool holding datasets cannot be rebuilt. See the ★ in resource.ts. */
export const ProxmoxZfsPool = Resource<ProxmoxZfsPool>('Proxmox.ZfsPool', {
  defaultRemovalPolicy: 'retain',
});

export const ProxmoxZfsPoolProvider = () =>
  Provider.effect(
    ProxmoxZfsPool,
    Effect.succeed(
      ProxmoxZfsPool.Provider.of({
        /** ⛔ EMPTY — `GET /nodes/{node}/disks/zfs` returns telemetry for every pool on the node,
         *   `rpool` included. Adoption stays explicit. */
        list: () => Effect.succeed([]),
        // ⚠️ FOLDS ONLY WHEN `output` IS `undefined` — storage.ts's own ⚠️, applied here from the
        //   start: `output === undefined` (Plan.ts's adoption probe, Apply.ts's delete recovery)
        //   keeps `readPool`'s fold; `output !== undefined` (Drift.ts's already-confirmed row)
        //   uses `readPoolOrFail` instead, so `alchemy drift` never reports a transient failure as
        //   a silent `{action: 'missing'}`.
        read: Effect.fn(function* ({ olds, output }) {
          return dropUnreadable(
            yield* output === undefined ? readPool(olds) : readPoolOrFail(olds),
          );
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          // ⚠️ `guardForm`, NOT `guardWrite` — the only migrated family whose create-guard is
          //   CONDITIONAL. `guardWrite`'s own signature requires a real `EndpointKey`, but decision
          //   9's adopt-only mode needs `undefined` some of the time (`zfsPoolCreateEndpoint`'s own
          //   header) — `guardForm` (constraint-guard.ts) is the one `distilled-guard.ts`'s
          //   `guardWrite` itself calls, and it already accepts `EndpointKey | undefined`.
          yield* guardForm(
            zfsPoolCreateEndpoint(news),
            asForm(createForm(news)),
            output === undefined,
          );
          if (output === undefined) return undefined;
          // ⚠️ `readPoolOrFail`, NOT `readPool` — a genuine TRANSIENT failure here propagates and
          //   fails the whole plan loudly instead of folding to "absent" and forcing a false
          //   update, the cries-wolf class of bug.
          const live = yield* readPoolOrFail(news);
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.ZfsPool', `${news.node}/${news.name}`);
            return { action: 'noop' } as const;
          }
          // ⛔ FOUND WRITING THIS FILE, 2026-09-24 — an earlier edit that removed the dead
          //   `matches()` call (zfs-pool-wire.ts's own ⛔) took this whole branch out with it,
          //   leaving a genuinely-absent pool planning `noop` unconditionally instead of `update`
          //   — a silent no-op on a state row Alchemy still holds, caught by
          //   zfs-pool-adopt.test.ts's own "an adopted pool that vanishes" case rejecting the plan
          //   loudly rather than resolving. Restored before this PR opened.
          if (live === undefined) {
            yield* guardForm(zfsPoolCreateEndpoint(news), asForm(createForm(news)), true);
            return { action: 'update' } as const;
          }
          // A live pool means `noop`, unconditionally — `matches` (zfs-pool-wire.ts's own ⛔)
          // always answers `true`, since every create parameter is write-only: there is nothing a
          // declaration and a live pool can be compared on, so nothing here can ever be a replace.
          return { action: 'noop' } as const;
        }),
        /**
         * ⛔ THE ONLY WRITE THIS FAMILY EVER MAKES IS `createPool`'s create — see zfs-pool-form.ts.
         *   An existing pool is returned exactly as read, unwritten.
         * ⚠️ `readPool` PIPED THROUGH `dropUnreadable` — `createPool`'s settle-poll treats a
         *   refused mid-poll credential exactly like "not found yet" (its own header), so its own
         *   `read` parameter is typed `Attributes | undefined`, never `Unreadable`; folding here is
         *   what keeps that true rather than leaking the sentinel into `reconcile`'s own return
         *   value, which the engine expects to be real attributes or nothing.
         */
        reconcile: Effect.fn(function* ({ news }) {
          return yield* createPool(news, (props) =>
            readPool(props).pipe(Effect.map(dropUnreadable)),
          );
        }),
        delete: Effect.fn(function* ({ olds }) {
          yield* destroyPool(olds);
        }),
      }),
    ),
  );
