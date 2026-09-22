/**
 * The scope Plan.ts gives every provider call it makes, for the calls the verifier makes itself
 * after the plan: `--all`'s reads (verify.ts) and the recheck's diffs (recheck.ts).
 *
 * ⚠️ RE-CREATED, BECAUSE Plan.ts DOES NOT EXPORT IT (`providePlanScope`, alchemy beta.79): a scoped
 *   `Artifacts` bag over the run's `ArtifactStore` (a fresh one when none is provided) and the row's
 *   `InstanceId`. A kit family that consults either — the ownership helpers do — sees what it
 *   would see under `alchemy plan`. Moved here from verify.ts once a second caller needed it.
 */
import {
  ArtifactStore,
  Artifacts,
  createArtifactStore,
  makeScopedArtifacts,
} from 'alchemy/Artifacts';
import { InstanceId } from 'alchemy/InstanceId';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

export const inPlanScope =
  (fqn: string, instanceId: string) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Exclude<R, Artifacts | InstanceId>> =>
    Effect.gen(function* () {
      const store = Option.getOrElse(
        yield* Effect.serviceOption(ArtifactStore),
        createArtifactStore,
      );
      return yield* effect.pipe(
        Effect.provideService(Artifacts, makeScopedArtifacts(store, fqn)),
        Effect.provideService(InstanceId, instanceId),
      );
    }) as Effect.Effect<A, E, Exclude<R, Artifacts | InstanceId>>;
