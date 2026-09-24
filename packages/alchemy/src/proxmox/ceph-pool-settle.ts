/**
 * Waiting for Ceph to finish, which is a concern of its own.
 *
 * ★ SPLIT OUT OF ceph-pool.ts FOR THE 250-LINE CAP, and the seam is real: every other PVE family
 *   in this package writes and reads back in one breath, because PVE's config endpoints are
 *   synchronous. Ceph's are not — a pool delete returns before the PGs are gone — so this file is
 *   the polling that difference forces, and ceph-pool.ts is the declaration.
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import type { CephPoolAttributes, CephPoolProps } from './ceph-pool-form.ts';
import { runPve } from './distilled-pve.ts';
import type { PveRequirements } from './resource.ts';

/**
 * ⚠️ THE DEPENDENCIES ARE PASSED IN RATHER THAN IMPORTED, and that is what made this file
 *   separable at all. `ops.read` — now `readPoolStatus` (ceph-pool-wire.ts) — is a module-level
 *   binding in ceph-pool.ts; importing it back would be a runtime cycle, and duplicating it would
 *   be two definitions of one path. Passing it is the pattern zfs-pool-write.ts already uses.
 */
export type PoolRead = (
  props: CephPoolProps,
) => Effect.Effect<CephPoolAttributes | undefined, never, PveRequirements>;

/**
 * ⛔ THE GUARD ON THE CREATE. `read` folds a 403, a timeout and a node that is down into the same
 *   `undefined` as a pool that is genuinely missing — so "absent" is not evidence. This asks a
 *   second, different question: does the cluster LIST this pool? A failure is left to propagate
 *   rather than folded, so "I could not ask" fails the deploy instead of creating over live data.
 *   An empty list is trusted: the collection 403s when the role is too narrow rather than
 *   filtering, so `[]` really does mean a cluster with no pools.
 *
 * ⚠️ `describe` IS STILL A PLAIN STRING (ceph-pool.ts builds it from `object`/`collection` in
 *   ceph-pool-form.ts) — this function no longer takes a `collection` PATH, since
 *   `nodes.listNodeCephPool` addresses the endpoint itself; the parameter list keeps `describe`
 *   only, to name the object in the refusal message.
 */
export const confirmAbsent = (props: CephPoolProps, describe: string) =>
  runPve(props.target, 'read', false, nodes.listNodeCephPool({ node: props.node })).pipe(
    Effect.flatMap((rows) =>
      rows.some((row) => row.pool_name === props.name)
        ? Effect.die(
            new Error(
              `${describe}: the cluster lists this pool but its status could not be read, ` +
                'so this deploy will NOT create over it. Check that the node is up and that the ' +
                'read role holds Sys.Audit or Datastore.Audit on / -- a create here would apply ' +
                'pg_num to a live pool and start a PG merge.',
            ),
          )
        : Effect.void,
    ),
  );

/**
 * Wait for the cluster to agree, then answer the last thing it said.
 *
 * ★ IT POLLS `matches`, THE SAME PREDICATE `diff` USES, so "settled" has exactly one definition in
 *   this file. Polling `/nodes/{node}/tasks/{upid}/status` instead would read the worker's own
 *   exit status, but it needs `Sys.Audit` on the node for a token that is NOT the one that started
 *   the task — every `pve` call mints a fresh token, so the task's owner check cannot pass.
 * ⚠️ SHORT POLLS, LOW CAP: 2s apart, 30 tries, about a minute. A pool create takes seconds; one
 *   still unsettled after a minute is a fault to surface, not a wait to lengthen.
 */
export const settle = (
  props: CephPoolProps,
  read: PoolRead,
  done: (live: CephPoolAttributes | undefined) => boolean,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const live = yield* read(props);
      if (done(live)) return live;
      yield* Effect.sleep('2 seconds');
    }
    return yield* read(props);
  });
