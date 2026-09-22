/**
 * Whether a `diff` or `reconcile` that holds attributes is looking at an ADOPTION — a live object
 * that reached this stack's state by being FOUND, not by this resource's own create — so a family
 * whose adoption must never change what it takes over (`Proxmox.Lxc`) can refuse any difference
 * instead of writing it. adopt.ts and probe.ts decide WHETHER an object may be claimed; this says,
 * once it is claimed, whether the claim is an adoption.
 *
 * ★ STATE ALREADY SAYS WHICH, AT BOTH HALVES OF A DEPLOY (alchemy 2.0.0-beta.79):
 *   · PLAN, A COLD ADOPTION. The probe mints an instance id no row can hold (Plan.ts
 *     `generateInstanceId()`), and `diff` then runs with that id and the attributes the probe
 *     read. So no row holds the id.
 *   · APPLY, THE SAME ADOPTION. Apply commits an `updating` row with `adopting: true` under that id
 *     BEFORE it calls reconcile, and the flag stays until the update commits (Apply.ts). An
 *     adoption whose apply was interrupted keeps it, so the next plan's `diff` sees it too.
 *   · A RECOVERED CREATE. A `creating` row with no attributes, whose live object the recovery read
 *     found. It is this resource's own create when the row proves it (probe.ts `provenOurs`, the
 *     same proof the read asked). Otherwise the plan went on only because `--adopt` said so — an
 *     adoption like any other.
 *   · Any other row with attributes is state vouching for the object: not an adoption.
 * ⚠️ OUTSIDE A STACK — no Stack or State in context, or a store that errors (rows.ts) — no row
 *   holds anything, so every call is an adoption: the strict answer, never the permissive one. A
 *   family then refuses an ordinary update's write as if it were an adoption's. `alchemy deploy`
 *   and the Alchemist session provide both services.
 */
import * as Effect from 'effect/Effect';
import type { Owner } from './adopt.ts';
import { provenOurs } from './probe.ts';
import { recordedGeneration } from './rows.ts';

/**
 * Whether `owner`'s call is an adoption (header). `settled` is the family's "live matches these
 * props", asked only for a recovered create, with the props of the row that recorded it.
 * ⛔ A CREATE IS NEVER ONE HERE. `output` undefined is reconcile's create path, which has its own
 *   rule for a live object it finds (adopt.ts `refuseTakeover`).
 */
export const adopting = <E, R>(
  owner: Owner,
  settled: (recorded: unknown) => Effect.Effect<boolean, E, R>,
): Effect.Effect<boolean, never, R> =>
  Effect.gen(function* () {
    if (owner.output === undefined) return false;
    const generation = yield* recordedGeneration(owner.fqn, owner.instanceId);
    if (generation === undefined || generation.adopting === true) return true;
    if (generation.attr !== undefined && generation.attr !== null) return false;
    return !(yield* provenOurs(owner, settled(generation.props)));
  });
