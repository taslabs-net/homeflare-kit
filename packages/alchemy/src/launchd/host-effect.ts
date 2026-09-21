/**
 * The one place a HostRunner's promises become Effects — plus the one probe of an unresolved
 * `news` both providers' diffs share.
 *
 * ★ The lifecycle files are plain async functions over a HostRunner (see runner.ts for why the
 *   runner is promise-based), so each provider handler is a single `lift(() => step(runner, …))`.
 * ⚠️ A thrown Error stays that Error — its message is the refusal a deploy prints. Anything else
 *   thrown is wrapped, so the failure channel is always an Error with a readable message.
 */
import * as Effect from 'effect/Effect';

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
