/**
 * What is staged on the SDN, across the WHOLE surface the apply publishes — not just the two
 * collections this package declares resources for.
 *
 * 🔴 THE GAP THIS FILE CLOSES, AND IT WAS FOUND BY ALMOST DECLARING THE APPLY. `pendingCount` in
 *   sdn-apply.ts counted `cluster/sdn/zones` and `cluster/sdn/vnets`. C1 has zero of each — and a
 *   staged OSPF FABRIC that nothing counted. MEASURED 2026-09-13 on node-b:
 *
 *     /etc/pve/sdn/fabrics.cfg   ospf_fabric: c1, area 1, ip_prefix 203.0.113.0/24
 *                                ospf_node: c1_n2/node-c/node-d, interfaces tb0 + tb1,
 *                                ip 203.0.113.102 / .103 / .104
 *     /etc/network/interfaces.d/sdn   the file PVE GENERATES from it, carrying those /32s
 *
 *   Those addresses are Ceph's `cluster_network`. So `diff` would have answered `noop` for ever
 *   while `PUT /cluster/sdn` republished the fabric and reloaded networking on all three nodes at
 *   once — the simultaneity the NetworkApply chain exists to prevent, arriving through the door
 *   nobody was watching.
 *
 * ⛔ THE SURFACE IS NOT UNIFORM, AND ASSUMING IT WAS IS WHAT MADE THE GAP INVISIBLE. Measured, one
 *   request per collection, per query:
 *
 *     zones, vnets, controllers, prefix-lists, route-maps   accept ?pending=1 and ?running=1,
 *                                                           and mark a staged row with `state`
 *     fabrics                                               accepts both, and its rows carry NO
 *                                                           `state` marker at all
 *     ipams, dns                                            REJECT both with HTTP 400,
 *                                                           "property is not defined in schema"
 *
 * ⛔ SO A `state`-ONLY TEST IS WRONG FOR FABRICS, AND `orElseSucceed(() => 0)` IS WORSE THAN WRONG
 *   FOR ipams AND dns. The old code folded an unreadable collection to zero — right for a cluster
 *   with no SDN at all, and indistinguishable from "this collection rejects the question". Adding
 *   ipams and dns to the old list would have counted them as 0 for ever and read as coverage.
 */
import * as Effect from 'effect/Effect';
import { PveError, pve } from './client.ts';
import type { PveTarget } from './credentials.ts';

/** A staged row. `state` is present only under `?pending=1`, and only when it differs from running. */
type PendingRow = { state?: string };

/**
 * Collections that answer `?pending=1` AND mark a staged row with `state`.
 *
 * ⚠️ THIS LIST IS WIDER THAN THE RESOURCES THIS PACKAGE SHIPS, ON PURPOSE, AND THAT REVERSES THE
 *   OLD COMMENT. It used to say counting a collection nothing declares would turn somebody else's
 *   hand-staged object into a permanent `update`. True — and the alternative is publishing that
 *   object without ever showing it in a plan. An apply that is cluster-wide must be honest about
 *   the whole cluster: a controller staged by hand in the UI is a thing this resource WILL push,
 *   so it has to be a thing this resource ADMITS to. A permanent `update` on somebody's abandoned
 *   half-edit is a loud, safe failure; publishing it silently is not.
 */
const MARKED = [
  'cluster/sdn/zones',
  'cluster/sdn/vnets',
  'cluster/sdn/controllers',
  'cluster/sdn/prefix-lists',
  'cluster/sdn/route-maps',
] as const;

/**
 * Collections with NO pending view at all.
 *
 * ⚠️ NAMED RATHER THAN SILENTLY SKIPPED. `ipams` and `dns` answer HTTP 400 to both `?pending=1` and
 *   `?running=1`, so there is no way to ask them what is staged. They are a REAL blind spot: an
 *   ipam edited by hand is published by the apply and cannot be seen from here. C1 has one ipam
 *   (`pve`, the built-in) and zero dns entries, so the blind spot is currently empty — which is a
 *   fact about today, not a property of the design.
 */
export const UNDIFFABLE = ['cluster/sdn/ipams', 'cluster/sdn/dns'] as const;

/**
 * Whether a failed read means "this SDN subsystem does not exist here" — the ONE failure that may
 * read as nothing staged.
 *
 * 🔴 IT USED TO BE EVERY FAILURE. `orElseSucceed` caught 401, 403, 5xx and a dropped connection
 *   along with the 501 it was written for, so an expired read lease or a missing grant answered
 *   "nothing staged": `diff` said noop, and the read-back after a real apply said settled while
 *   objects were still staged. The fabric views were worse because they are COMPARED — one view
 *   failing while the other succeeded read as a DIFFERENCE, which is `PUT /cluster/sdn` and a
 *   network reload carrying Ceph's cluster network on all three nodes, over a timeout. Found in
 *   review on 2026-09-14 and confirmed by reading.
 * ⛔ SO ANYTHING ELSE FAILS THE READ. A plan that stops on an unreadable SDN is loud and safe; a
 *   plan that guesses is neither.
 */
export const subsystemAbsent = (error: unknown): boolean =>
  error instanceof PveError && error.status === 501;

/** Staged rows in the collections that mark them. */
const markedPending = (target: PveTarget) =>
  Effect.all(
    MARKED.map((collection) =>
      pve<PendingRow[]>(target, 'read', 'GET', `${collection}?pending=1`).pipe(
        Effect.map((rows) => (rows ?? []).filter((row) => row.state !== undefined).length),
        /**
         * ⚠️ AN ABSENT COLLECTION COUNTS AS ZERO, AND THAT IS STILL RIGHT HERE — but ONLY an absent
         *   one. Some versions answer 501 for an SDN subsystem that has never been configured, and
         *   failing the whole plan over it would make this resource undeclarable on a cluster with
         *   no SDN. The collections that REJECT the question are handled by not asking them — see
         *   UNDIFFABLE — and every other failure is a failure; see `subsystemAbsent`.
         */
        Effect.catchIf(subsystemAbsent, () => Effect.succeed(0)),
      ),
    ),
    { concurrency: 'unbounded' },
  ).pipe(Effect.map((counts) => counts.reduce((total, count) => total + count, 0)));

/**
 * Staged fabric changes from the two canonical views, where `undefined` is a view whose subsystem
 * answered 501.
 *
 * ⛔ ONE VIEW ABSENT AND ONE PRESENT IS NOT A DIFFERENCE. It is one endpoint answering two
 *   questions inconsistently, and a difference is exactly what triggers the publish — so it is
 *   refused rather than counted.
 */
export const fabricStaged = (
  staged: string | undefined,
  running: string | undefined,
): number | 'inconsistent' => {
  if (staged === undefined && running === undefined) return 0;
  if (staged === undefined || running === undefined) return 'inconsistent';
  return staged === running ? 0 : 1;
};

/**
 * Whether the fabric config differs between staged and applied.
 *
 * ★ COMPARING THE TWO VIEWS IS THE TEST, BECAUSE THERE IS NO `state` TO READ. `?pending=1` is the
 *   staged config and `?running=1` is what the nodes are actually running; equal means nothing to
 *   publish. `cluster/sdn/fabrics/all` returns both fabrics and nodes in ONE call, which is why it
 *   is asked rather than the two subdirectories.
 *
 * ⚠️ `digest` IS STRIPPED BEFORE COMPARING. The pending view carries one and the running view does
 *   not — MEASURED — so comparing raw bodies reports a difference on a cluster where nothing has
 *   changed, which is exactly the forever-diff this package has fixed three times elsewhere.
 * ⚠️ AND THE ORDER OF THE NODE LIST IS NOT STABLE between the two reads, so both sides are
 *   canonically sorted. Order is not meaning in a set of fabric nodes.
 */
const fabricPending = (target: PveTarget) =>
  Effect.all(
    ['pending', 'running'].map((view) =>
      pve<unknown>(target, 'read', 'GET', `cluster/sdn/fabrics/all?${view}=1`).pipe(
        Effect.map(canonical),
        Effect.catchIf(subsystemAbsent, () => Effect.succeed(undefined)),
      ),
    ),
    { concurrency: 'unbounded' },
  ).pipe(
    Effect.flatMap(([staged, running]) => {
      const verdict = fabricStaged(staged, running);
      return verdict === 'inconsistent'
        ? Effect.die(
            new Error(
              'cluster/sdn/fabrics/all answered 501 for one of ?pending=1 and ?running=1 and not ' +
                'the other. Refusing to read that as a staged fabric change.',
            ),
          )
        : Effect.succeed(verdict);
    }),
  );

/** Stable JSON with `digest` removed and every array sorted, so only real differences show. */
export const canonical = (value: unknown): string => JSON.stringify(sortDeep(value));

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(sortDeep)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'digest')
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, inner]) => [key, sortDeep(inner)]));
  }
  return value;
};

/**
 * How many staged changes the apply would publish, across everything it is capable of publishing.
 *
 * ⛔ ZERO HERE IS THE ONLY THING THAT MAKES DECLARING THE APPLY SAFE. `reconcile` runs on CREATE —
 *   Alchemy always calls it the first time a resource appears — and `PUT /cluster/sdn` regenerates
 *   `/etc/network/interfaces.d/sdn` on every node. On C1 that file carries Ceph's cluster network.
 */
export const sdnPendingCount = (target: PveTarget) =>
  Effect.all([markedPending(target), fabricPending(target)], { concurrency: 'unbounded' }).pipe(
    Effect.map(([marked, fabric]) => marked + fabric),
  );
