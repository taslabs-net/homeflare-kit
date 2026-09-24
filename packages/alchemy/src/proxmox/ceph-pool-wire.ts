/**
 * `Proxmox.CephPool`'s distilled wire lane: the status read, and the two request translations.
 *
 * ★ SPLIT OUT OF ceph-pool-form.ts FOR THE 250-LINE CAP (that file is already near it) — the seam
 *   is "touches the cluster or not", the same one ceph-pool-form.ts itself draws against
 *   ceph-pool.ts. Nothing in ceph-pool-form.ts changed: `createBody`/`updateBody` still build the
 *   PVE form, unaware distilled exists: this file is the ONLY place that translates one into a
 *   typed distilled request.
 *
 * ⛔ ONE READ FUNCTION, NOT THE readXOrFail/foldingX PAIR user.ts/group.ts/storage.ts/zfs-pool.ts/
 *   node-network-wire.ts CARRY. THIS IS A DELIBERATE, MEASURED DIFFERENCE, NOT AN OVERSIGHT. Those
 *   families were BUILT with (or later given, after the NodeNetwork adversarial review) the
 *   dual-path pattern because their `diff`/`read` hooks needed to tell "genuinely absent" apart
 *   from "a transient failure" at specific call sites. CephPool's PRE-MIGRATION behaviour never
 *   had that distinction: `resource.ts`'s generic `pveOperations.read` — what `ops.read`/`ops.diff`
 *   called before this PR — folds EVERY failure into `undefined` unconditionally
 *   (`Effect.orElseSucceed(() => undefined)`, no `output`-branching, checked directly against
 *   `resource.ts` 2026-09-24). This migration's own rule is that every existing refusal and guard
 *   survives byte-for-byte — not that it gets upgraded on the way past. `readPoolStatus` below
 *   reproduces that exact single-fold shape; it does not add the newer pattern.
 * ⚠️ WORTH A LATER, SEPARATELY-SCOPED DECISION: this means CephPool (like CephDaemon) still folds
 *   a refused OpenBao mint into "absent" too, same as every other pre-`unreadable-read.ts` family
 *   — the cries-wolf class `Proxmox.NodeNetwork`/`Proxmox.ZfsPool`/`Proxmox.Storage` were fixed
 *   against. Noted here rather than fixed here, since fixing it is a behaviour change this PR's
 *   own rules do not ask for.
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import {
  type CephPoolAttributes,
  type CephPoolProps,
  UNSET,
  applications,
  createBody,
  updateBody,
} from './ceph-pool-form.ts';
import { bool, int, num, text } from './values.ts';

/**
 * One status answer as attributes, or `undefined` for the index-trap shape — the same defensive
 * check ceph-pool.ts's pre-migration `attributes` carried, kept even though a well-formed
 * distilled decode should never hand this function anything else: `GetNodeCephPoolStatusResponse`
 * declares `name` required, so a response shaped like the INDEX (an array) fails the Schema decode
 * before this runs at all. Left in as the same fail-safe rather than trusting that alone.
 *
 * ⚠️ `live` IS CAST PAST `GetNodeCephPoolStatusResponse`'s OWN TS TYPE, the same measured reason
 *   node-network-wire.ts's `attributesOf` casts past `GetNodeNetworkResponse`: Effect Schema's
 *   structural (non-exact) decode does not strip fields the declared type omits, and the live
 *   probe below (2026-09-24) showed extra fields (`statistics`, `autoscale_status`) surviving.
 */
const attributesOf = (live: unknown, props: CephPoolProps): CephPoolAttributes | undefined => {
  const row = live as Record<string, unknown>;
  if (typeof row['name'] !== 'string') return undefined;
  return {
    applications: applications(row['application_list']),
    crush_rule: text(row['crush_rule']),
    id: int(row['id'], UNSET),
    min_size: int(row['min_size'], UNSET),
    name: props.name,
    node: props.node,
    nodelete: bool(row['nodelete']),
    nopgchange: bool(row['nopgchange']),
    nosizechange: bool(row['nosizechange']),
    pg_autoscale_mode: text(row['pg_autoscale_mode']),
    pg_num: int(row['pg_num'], UNSET),
    pg_num_min: int(row['pg_num_min'], UNSET),
    size: int(row['size'], UNSET),
    target_size: int(row['target_size'], UNSET),
    target_size_ratio: num(row['target_size_ratio'], UNSET),
  };
};

/**
 * The live pool, or `undefined` — folds every failure, exactly as `ops.read` did. Used by `read`,
 * `diff` (via `ceph-pool.ts`'s own hand-written `reconcile`, which predates the factory) and
 * `settle` (ceph-pool-settle.ts) alike, matching the ONE-function shape this family had before.
 *
 * ⛔ `verbose=1` IS WHAT MAKES `applications` VISIBLE AT ALL — ceph-pool.ts's own header has the
 *   measured reason and the cost (two extra, unguarded mon commands PVE runs to answer it).
 */
export const readPoolStatus = (props: CephPoolProps) =>
  runPve(
    props.target,
    'read',
    false,
    nodes.getNodeCephPoolStatus({ name: props.name, node: props.node, verbose: '1' }),
  ).pipe(
    Effect.map((live) => attributesOf(live, props)),
    Effect.orElseSucceed(() => undefined),
  );

/** The two endpoints, as the keys `guardWrite` (distilled-guard.ts) checks both forms against. */
export const CEPH_POOL_CREATE = 'pve:POST /nodes/{node}/ceph/pool';
export const CEPH_POOL_UPDATE = 'pve:PUT /nodes/{node}/ceph/pool/{name}';

/** The actual `createNodeCephPool` call body — `createBody`, translated. No field is renamed. */
export const toDistilledCreate = (props: CephPoolProps): nodes.CreateNodeCephPoolRequest =>
  ({
    ...createBody(props),
    node: props.node,
  }) as unknown as nodes.CreateNodeCephPoolRequest;

/** The actual `putNodeCephPool` call body — `updateBody`, translated. No field is renamed. */
export const toDistilledUpdate = (props: CephPoolProps): nodes.PutNodeCephPoolRequest =>
  ({
    ...updateBody(props),
    name: props.name,
    node: props.node,
  }) as unknown as nodes.PutNodeCephPoolRequest;
