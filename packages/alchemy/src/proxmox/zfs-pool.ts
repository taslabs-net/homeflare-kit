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
 *   surface. So `updateForm` is omitted — which, per `resource.ts`, makes any `matches` = false a
 *   REPLACE. A replace is a delete followed by a create, and on this family the delete is the
 *   thing above. Read the ⛔ on `matches` before adding anything to it.
 *
 * ⛔ NOT ONE CREATE PARAMETER COMES BACK ON READ, SO `matches` COMPARES NOTHING. MEASURED against
 *   the live cluster: `GET /nodes/node-b/disks/zfs/rpool` answers exactly
 *   `{action, children, errors, leaf, name, scan, state, status}` — no `ashift`, no `compression`,
 *   no `raidlevel`, no `devices`, no `add_storage`. Every create parameter is write-only. There is
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
 * ⚠️ TWO HANDLERS ARE OVERRIDDEN AND THE OTHER THREE COME FROM THE FACTORY — see the ★ above
 *   `handlers`. `delete` is the ⛔ above. `reconcile` is because the create is a FORKED WORKER, so
 *   the factory's immediate read-back would report a successful create as a failure; the measured
 *   detail, and the adopt-only refusal decision 9 adds, are both in `createPool` in
 *   zfs-pool-write.ts.
 *
 * ⚠️ PRIVILEGES, FROM THE SCHEMA. Read and diff need `Sys.Audit` on `/` — both GETs check it.
 *   Reconcile needs `Sys.Modify` on `/` for the POST. `Datastore.Allocate` on `/storage` is NOT
 *   needed, because `add_storage` is not offered — see the ⛔ on `ZfsPoolProps`. `delete` needs
 *   nothing at all, since it calls nothing.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { NodesNodeDisksZfsPostParams } from './generated/pve.ts';
import { type PveRequirements, type WithTarget, pveHandlers, pveOperations } from './resource.ts';
import { spec } from './zfs-pool-spec.ts';
import { createPool, destroyPool } from './zfs-pool-write.ts';

/**
 * PVE's layouts, generated (2026-09-23) from `NodesNodeDisksZfsPostParams['raidlevel']`
 * (`generated/pve.ts`, manifest `pve-apidoc` pve-manager 9.2.11 sha256 9def8f13…) rather than
 * hand-typed, per decision 9. ⚠️ Each has a minimum disk count PVE enforces, and `raid10` needs an
 * even one. ⛔ THERE IS NO `stripe` IN THIS ENUM. n1's `speed` pool is one (decision 14 accepts it
 * as-is): `ZfsPoolProps` below is why a stripe pool is declarable at all — as an ADOPT-ONLY
 * declaration with no `raidlevel`, never as a full one.
 */
export type ZfsRaidLevel = NonNullable<NodesNodeDisksZfsPostParams['raidlevel']>;

/** Generated the same way, from `NodesNodeDisksZfsPostParams['compression']`. */
export type ZfsCompression = NonNullable<NodesNodeDisksZfsPostParams['compression']>;

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
   *   `raidlevel` enum (above) has no stripe to declare. `createForm` (zfs-pool-write.ts) omits
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

/**
 * ⚠️ EVERYTHING HERE IS REPORTED, NOTHING HERE IS COMPARED — see the ⛔ on `matches`. These exist
 *   so a plan and the state store can say what the pool actually is, on a family where the
 *   declaration and the live object share no comparable field at all.
 */
export interface ZfsPoolAttributes {
  /** ★ The value a `Proxmox.Storage` should read to order itself after this pool. */
  name: string;
  node: string;
  /** `ONLINE` | `DEGRADED` | `FAULTED` | … Health, not configuration. */
  state: string;
  /** ZFS's own error summary, e.g. `No known data errors`. */
  errors: string;
  /**
   * The leaf devices ZFS reports, in vdev order, comma-joined.
   *
   * ⚠️ THIS IS WHAT ZFS RESOLVED, NOT WHAT WAS DECLARED, and the two normally differ: PVE rewrites
   *   a `/dev/sdb` into a by-id link before creating, and ZFS reports partition paths (`…-part3`)
   *   for a pool built on partitions — MEASURED, that is exactly what node-b's `rpool` reports. Never
   *   compare it with `props.devices`.
   */
  devices: string;
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

const ops = pveOperations(spec);

/**
 * ★ THREE HANDLERS COME FROM THE FACTORY AND TWO DO NOT, SO THE TWO ARE THE ONLY ONES WRITTEN OUT.
 *   `list`, `read` and `diff` are the factory's, unchanged — the spread is what proves it, rather
 *   than three re-typed delegations nobody rereads. `reconcile` and `delete` are the two the header
 *   explains, and they are the only places this family departs from every other resource here.
 *   This is the acl.ts precedent, for a different reason: there the factory's delete hits an
 *   endpoint PVE does not implement, here it hits one that works and destroys the data.
 */
const handlers = {
  ...pveHandlers(spec),
  delete: Effect.fn(function* ({ olds }: { olds: ZfsPoolProps }) {
    yield* destroyPool(olds, spec.path(olds));
  }),
  reconcile: ({ news }: { news: ZfsPoolProps }) =>
    createPool(news, spec.collection(news), spec.path(news), ops.read),
};

export const ProxmoxZfsPoolProvider = () =>
  Provider.effect(ProxmoxZfsPool, Effect.succeed(ProxmoxZfsPool.Provider.of(handlers)));
