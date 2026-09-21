/**
 * The one place a HostRunner's promises become Effects — plus the one probe of an unresolved
 * `news` both providers' diffs share, and the engine's adopt setting for a check at apply.
 *
 * ★ The lifecycle files are plain async functions over a HostRunner (see runner.ts for why the
 *   runner is promise-based), so each provider handler is a single `lift(() => step(runner, …))`.
 * ⚠️ A thrown Error stays that Error — its message is the refusal a deploy prints. Anything else
 *   thrown is wrapped, so the failure channel is always an Error with a readable message.
 */
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import { Stack } from 'alchemy/Stack';
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
 * Whether the resource at `fqn` may be adopted, resolved exactly as the planner resolves it (alchemy
 * beta.79 Plan.ts: `resource.Adopt ?? shouldAdopt`): a resource-scoped `adopt(…)`, else the
 * `AdoptPolicy` service, else `AlchemyContext.adopt`, else off.
 * ★ FOR A CREATE THE ENGINE NEVER PROBED. Alchemy skips the adoption probe while `news` holds an
 *   Output, so an ownership check that must still honour `--adopt` can only run at apply. All three
 *   reach the apply: Alchemist runs plan AND apply under the session context, which provides the
 *   services from the CLI flag and the Stack the resources registered on (Alchemist/Session.ts,
 *   routes/stack.ts; Apply.ts reads the same Stack).
 * ⛔ THE RESOURCE-SCOPED SETTING WINS, BOTH WAYS. The engine captures `adopt(…)` on the resource at
 *   registration (Resource.ts `Adopt`, into `Stack.resources[fqn]`) and never hands it to a
 *   provider. Reading only the deploy-wide flag let `--adopt` take over a resource declared
 *   `.pipe(adopt(false))` — which the planner refuses — and refused one declared `adopt(true)`.
 * ⚠️ `resources` carries an `@internal` comment in Alchemy's source, but it is in the published types
 *   and the planner reads `Adopt` from it. caddy/adopt-scope.test.ts registers through the real
 *   `Resource`, so an upgrade that stops recording it there fails the suite.
 */
export const adoptEnabled = (fqn: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const stack = yield* Effect.serviceOption(Stack);
    const scoped = Option.isSome(stack) ? stack.value.resources[fqn]?.Adopt : undefined;
    if (scoped !== undefined) return scoped;
    const policy = yield* Effect.serviceOption(AdoptPolicy);
    if (Option.isSome(policy)) return policy.value;
    const context = yield* Effect.serviceOption(AlchemyContext);
    return Option.isSome(context) ? context.value.adopt : false;
  });
