/**
 * Whether a stateless `LiteLLM.Model` reconcile may write the live row it found.
 *
 * ⛔ A ROW WITH NO SEAL IS NOT YET THIS GENERATION'S. `output` is undefined on a create and on a
 *   `replacing` row Apply committed before reconcile (Apply.ts), and a probe result carries
 *   `paramsSeal: ''`. Either way the live row may belong to someone else.
 * ★ TWO ROWS THAT LOOK THE SAME AND ARE NOT. A deterministic id this declaration would create is
 *   ours by construction. An older generation's `attr.id` (ownership/rows.ts) is our own serving
 *   deployment from before this replacement — recording it here makes destroy() delete it. A
 *   declared id needs `--adopt` on a create or an unfinished generation; an unpinned row with any
 *   other id is adopted only on a create (ownership/adopt.ts).
 */
import * as Effect from 'effect/Effect';
import { adoptEnabled, adoptsAtApply } from '../ownership/adopt.ts';
import { adopting } from '../ownership/adopting.ts';
import { isCreate, olderGenerationIds } from '../ownership/rows.ts';
import { unfinished } from '../ownership/resume.ts';
import { LitellmModelForeignRowError, LitellmModelPriorGenerationError } from './model-errors.ts';
import type { ModelAttributes, ModelProps } from './model-types.ts';

export const claimStatelessRow = (args: {
  readonly fqn: string;
  readonly instanceId: string;
  readonly output: ModelAttributes | undefined;
  readonly news: ModelProps;
  readonly beforeId: string;
  readonly wanted: string;
}): Effect.Effect<void, LitellmModelPriorGenerationError | LitellmModelForeignRowError> =>
  Effect.gen(function* () {
    const older = yield* olderGenerationIds(args.fqn, args.instanceId);
    // ⛔ NOT OURS, EVEN WITH --adopt. The id is the previous generation's. Accepting it stores
    //   that id on this generation; destroy() GC then deletes the old generation by the same id
    //   (Apply.ts ~2168). The way back is `alchemy state rm`, then a deploy with --adopt.
    if (older.includes(args.beforeId)) {
      return yield* Effect.fail(
        new LitellmModelPriorGenerationError({
          fqn: args.fqn,
          id: args.beforeId,
          modelName: args.news.modelName,
        }),
      );
    }
    // ⛔ ONLY A DETERMINISTIC ID IS OURS BY CONSTRUCTION. With no declared id, `wanted` is the
    //   physical name this declaration would create. A row found by name with any other id is not
    //   the one this generation posted — a resumed unpinned replace must not `--adopt` it.
    //   A DECLARED id is a name a human chose, so a matching row goes through the adoption gate,
    //   which `--adopt` may pass for a create or an unfinished generation (the read-back that
    //   died after `POST /model/new`).
    const unpinned = args.news.id === undefined;
    const ours = unpinned && args.beforeId === args.wanted;
    const owner = { fqn: args.fqn, instanceId: args.instanceId, output: args.output };
    const isAdoption = yield* adopting(owner, () => Effect.succeed(false));
    const creating = yield* isCreate(args.fqn, args.instanceId);
    const mayAdopt = unpinned
      ? creating && (yield* adoptEnabled(args.fqn))
      : yield* adoptsAtApply(owner);
    if (!ours && !isAdoption && !mayAdopt) {
      // A declared id's unfinished generation is the one `--adopt` resumes. An unpinned row whose
      // id is not the physical name is a different deployment, replace or not.
      const replace = unpinned ? !creating : !creating && !(yield* unfinished(args.instanceId));
      return yield* Effect.fail(
        new LitellmModelForeignRowError({
          id: args.beforeId,
          modelName: args.news.modelName,
          replace,
        }),
      );
    }
  });
