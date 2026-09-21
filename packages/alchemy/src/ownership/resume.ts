/**
 * Whether this apply RESUMES a create or replace the engine already started for this resource —
 * the one case in which a live object found by a stateless `reconcile` can be our own.
 *
 * ★ HOW THE ENGINE TELLS US. Alchemy calls `diff` whenever a state row exists, and hands it `output`
 *   = that row's attributes (alchemy beta.79 Plan.ts). A row with NO attributes is exactly an
 *   unfinished generation: `creating` (a create interrupted after its write, before its commit),
 *   `replacing` (the same for a replace), or `deleting` re-driven as a create. A fresh create is
 *   never diffed at all. So a diff that sees `output === undefined` notes the instance it was
 *   asked about, and the apply that follows (the same instance id: Apply.ts reuses the row's)
 *   finds the note.
 * ⚠️ WHY NOT THE STATE STORE. At reconcile both look the same: Apply commits the fresh create's
 *   `creating` row before calling reconcile, so a row with this instance id is always there.
 * ★ THE CHANNEL IS ALCHEMY'S OWN: `Artifacts`, the per-FQN bag the engine shares between one plan
 *   and its apply (Artifacts.ts: "diff computes … create / update reads the same artifact").
 *   Deploy.ts and the Alchemist session both hold one store across the pair.
 * ⚠️ IT FAILS CLOSED. No bag (a caller that runs plan and apply without a shared store), or a bag
 *   the plan never wrote, reads as a fresh create, and adopt.ts then asks for `--adopt` — the safe
 *   direction, and the flag it asks for resumes the create.
 */
import { Artifacts } from 'alchemy/Artifacts';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

const KEY = 'homeflare/ownership/resumes';

/** `diff`'s answer when state has no attributes: note the resumed instance, then defer (undefined). */
export const noteResume = (instanceId: string): Effect.Effect<undefined> =>
  Effect.gen(function* () {
    const bag = yield* Effect.serviceOption(Artifacts);
    if (Option.isSome(bag)) yield* bag.value.set(KEY, instanceId);
    return undefined;
  });

/** Whether the plan for this apply noted `instanceId` as a resumed create or replace. */
export const resumes = (instanceId: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const bag = yield* Effect.serviceOption(Artifacts);
    if (Option.isNone(bag)) return false;
    return (yield* bag.value.get<string>(KEY)) === instanceId;
  });
