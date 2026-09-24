/**
 * `Proxmox.ZfsPool`'s READ side: the live-to-attributes shape, the read itself, and `matches`.
 * Split out of zfs-pool.ts (2026-09-24, the distilled migration) — the storage.ts/storage-wire.ts
 * seam; the write side is zfs-pool-form.ts.
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import type { ZfsPoolProps } from './zfs-pool.ts';
import { UNREADABLE, type Unreadable, readOrUnreadable } from './unreadable-read.ts';
import { text } from './values.ts';

/**
 * ⚠️ EVERYTHING HERE IS REPORTED, NOTHING HERE IS COMPARED — see the ⛔ on `matches` below. These
 *   exist so a plan and the state store can say what the pool actually is, on a family where the
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
   *   for a pool built on partitions — MEASURED, that is exactly what node-b's `rpool` reports.
   *   Never compare it with `props.devices`.
   */
  devices: string;
}

/**
 * The device paths at the bottom of PVE's vdev tree, in the order ZFS reports them.
 *
 * ⚠️ "NO CHILDREN" IS THE LEAF TEST, AND IT IS NOT A GUESS — MEASURED in the node's `preparetree`,
 *   which sets `leaf` to 0 when there are children and 1 otherwise. Reading the flag would work
 *   equally well; recursing on `children` needs no second field to be present and is what makes
 *   nested sections (mirrors inside a raid10, `spares`, `cache`) flatten correctly.
 */
export const leafDevices = (children: unknown): string[] =>
  Array.isArray(children)
    ? children.flatMap((entry: unknown) => {
        const vdev = entry as { children?: unknown; name?: unknown };
        const nested = leafDevices(vdev.children);
        return nested.length > 0 ? nested : [text(vdev.name)].filter((name) => name !== '');
      })
    : [];

/**
 * ⚠️ `scan`, `status` AND `action` ARE DELIBERATELY NOT ATTRIBUTES. All three are advisory strings
 *   ZFS rewrites on its own — `scan` on every scrub, the other two as feature flags and faults come
 *   and go — so keeping them would rewrite this resource's state row for reasons no declaration
 *   caused. Same reasoning as `digest` in storage.ts.
 */
const attributesOf = (
  live: nodes.GetNodeDiskZfsResponse,
  props: ZfsPoolProps,
): ZfsPoolAttributes => ({
  devices: leafDevices(live.children).join(','),
  errors: text(live.errors, 'unknown'),
  name: props.name,
  node: props.node,
  state: text(live.state, 'unknown'),
});

/**
 * ★ Default `read` role — `Sys.Audit` on `/` is all this GET checks (zfs-pool.ts's header).
 * ⛔ `{ node: props.node, name: props.name }`, NEVER THE WHOLE `props` — storage.ts's/user.ts's own
 *   ⛔, the kit 0.31.1 regression: `GetNodeDiskZfsRequest`'s schema declares only `node` and `name`
 *   (both path labels); any OTHER key on the object passed to `nodes.getNodeDiskZfs` is treated by
 *   distilled's `buildRequest` as an "unknown key" and JSON-encoded onto this bodyless GET, which a
 *   stricter fetch client refuses outright.
 * ⛔ A MISSING POOL IS A 500, NOT A 404 — MEASURED against the live cluster (TB4 n2, 2026-09-24,
 *   read-role, read-only probe): `GET /nodes/n2/disks/zfs/hf-measure-nonexistent-pool` answers
 *   `{"message":"command '/sbin/zpool status -P hf-measure-nonexistent-pool' failed: exit code
 *   1\n","data":null}` at HTTP 500 — PVE shells out to `zpool status` and reports its exit code
 *   as a generic command failure, not a typed "not found". The same shape as user.ts's/group.ts's/
 *   storage.ts's own measured 500s. `readPool` below (used by `createPool`'s settle-poll and by
 *   `reconcile`/`read`) still folds it, exactly as `readUser`/`readGroup`/`readStorage` do — the
 *   whole reason `createPool` can tell "not built yet" from "forbidden" only by giving up after
 *   `SETTLE_ATTEMPTS` (zfs-pool-form.ts's own ⚠️ on that); `readPoolOrFail` (used by `diff`) does
 *   not fold it, so a genuine transient failure there propagates and fails the plan loudly instead.
 */
export const readPoolOrFail = (props: ZfsPoolProps) =>
  readOrUnreadable(
    runPve(
      props.target,
      'read',
      false,
      nodes.getNodeDiskZfs({ name: props.name, node: props.node }),
    ),
  ).pipe(
    Effect.map((live) => {
      if (live === UNREADABLE) return UNREADABLE;
      // ⚠️ A detail answer with no `name` is not a pool — same shape check zfs-pool-spec.ts made,
      //   kept as a defensive fallback now that the 500 above is the measured absence signal.
      return text(live.name) === '' ? undefined : attributesOf(live, props);
    }),
  );

/**
 * ⛔ FOLDS A GENUINE READ FAILURE TO `undefined` TOO, AND ONLY `createPool`'s settle-poll AND
 *   `read`/`reconcile` MAY USE IT — user.ts's `readUser` has the full reasoning. Safe here because
 *   a wrongful fold during create costs at most a redundant `createNodeDiskZfs` POST, which PVE
 *   refuses loudly ("pool already exists") rather than silently corrupting anything — zfs-pool.ts's
 *   own header, measured.
 * ⛔ `zfs-pool.ts`'s `diff` does **NOT** use this — the same bug class as the credential denial fix:
 *   folding a TRANSIENT failure into "absent" at PLAN TIME would force a false `update` with
 *   nothing compared. `diff` calls `readPoolOrFail` directly, so a genuine failure there propagates
 *   and fails the whole plan loudly instead.
 */
export const readPool = (props: ZfsPoolProps) =>
  readPoolOrFail(props).pipe(Effect.orElseSucceed(() => undefined));

/** `read`/`reconcile`/`createPool` return `Attributes | undefined`; only `diff` sees `UNREADABLE`. */
export const dropUnreadable = (live: ZfsPoolAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;

/**
 * ⛔ THERE IS NO `matches` FUNCTION HERE — UNLIKE EVERY OTHER MIGRATED FAMILY, AND DELIBERATELY.
 *   Every create parameter on this family is write-only (this file's own `attributesOf`), so
 *   there is nothing a declaration and a live pool can ever be compared on — a `matches` that
 *   invented one would plan a replace (`zpool destroy`, since this family has no PUT) over a
 *   difference it could never verify. `zfs-pool.ts`'s `diff` returns `noop` unconditionally once a
 *   pool is found, rather than calling a function that would only ever return `true` — found by
 *   adversarial review that an earlier draft exported one here anyway, unused by anything.
 */
