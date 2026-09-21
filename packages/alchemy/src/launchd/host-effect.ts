/**
 * The one place a HostRunner's promises become Effects — plus the one probe of an unresolved
 * `news` both providers' diffs share, and the engine's `--adopt` setting for a check at apply.
 *
 * ★ The lifecycle files are plain async functions over a HostRunner (see runner.ts for why the
 *   runner is promise-based), so each provider handler is a single `lift(() => step(runner, …))`.
 * ⚠️ A thrown Error stays that Error — its message is the refusal a deploy prints. Anything else
 *   thrown is wrapped, so the failure channel is always an Error with a readable message.
 */
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

export const lift = <A>(step: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    try: step,
  });

/**
 * A string prop of a diff's `news`, when that one prop is already resolved; `undefined` while it
 * is still an Output (a function-typed proxy), an Effect or a Config.
 * ★ For the identity props a diff must see even when the rest of `news` is unresolved — a plain
 *   string is resolved by definition, so `typeof` is the whole test.
 */
export const resolvedString = (news: unknown, key: string): string | undefined => {
  if (typeof news !== 'object' || news === null) return undefined;
  const value = (news as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Whether this deploy runs with `--adopt`, resolved exactly as the planner resolves it (alchemy
 * beta.79 Plan.ts `shouldAdopt`): the `AdoptPolicy` service, else `AlchemyContext.adopt`, else off.
 * ★ FOR A CREATE THE ENGINE NEVER PROBED. Alchemy skips the adoption probe while `news` holds an
 *   Output, so an ownership check that must still honour `--adopt` can only run at apply. Both
 *   services reach the apply: Alchemist runs plan AND apply under the session context, which
 *   provides them from the CLI flag (Alchemist/Session.ts, routes/stack.ts).
 * ⚠️ A RESOURCE-SCOPED `adopt(true)` DOES NOT REACH HERE. The engine captures it on the resource at
 *   registration (Resource.ts `Adopt`) and consults it only in the plan; a provider sees the
 *   deploy-wide setting. Use `--adopt` for a takeover that happens at apply.
 */
export const adoptEnabled: Effect.Effect<boolean> = Effect.gen(function* () {
  const policy = yield* Effect.serviceOption(AdoptPolicy);
  if (Option.isSome(policy)) return policy.value;
  const context = yield* Effect.serviceOption(AlchemyContext);
  return Option.isSome(context) ? context.value.adopt : false;
});
