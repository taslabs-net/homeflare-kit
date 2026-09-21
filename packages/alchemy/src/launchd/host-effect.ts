/**
 * The one place a HostRunner's promises become Effects.
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
