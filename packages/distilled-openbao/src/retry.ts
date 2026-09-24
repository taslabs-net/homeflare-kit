/**
 * OpenBao retry surface — a veneer over `@distilled.cloud/core/retry`.
 *
 * The `Retry` service tag is threaded into every generated operation via
 * `API.make({ retry: Retry })`, so a caller-installed policy applies to all
 * OpenBao calls below it and core's `makeDefault` is the fallback when none
 * is provided.
 *
 * ⚠️ THIS IS NOT THE ESTATE'S CONCURRENCY GATE. The kit's own
 * `packages/alchemy/src/openbao/bao-http.ts` caps in-flight OpenBao
 * exchanges at 8 process-wide (`BaoGate`, a `Semaphore`) after a real
 * outage: unbounded Alchemy fan-out took the dev listener's socket down
 * (measured 2026-09-14). That cap is `HttpClient` middleware, not a retry
 * policy, and stays exactly where it is — the kit's Effect runtime provides
 * the gated `HttpClient.HttpClient` layer underneath whichever protocol
 * (hand-rolled or this SDK) issues the request, so it keeps applying
 * unchanged to every call this package makes.
 *
 * @example
 * ```ts
 * import * as OpenBao from "@distilled.cloud/openbao";
 *
 * myEffect.pipe(OpenBao.Retry.transient);
 * ```
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Retries from "@distilled.cloud/core/retry";

export type Options = Retries.Options;
export type Factory = Retries.Factory;
export type Policy = Retries.Policy;

/** Context tag for configuring retry behavior of OpenBao API calls. */
export class Retry extends Context.Service<Retry, Policy>()("OpenBaoRetry") {}

/** Provides a custom retry policy to every OpenBao API call below it. */
export const policy: {
  (
    options: Options,
  ): <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Retry>>;
  (
    factory: Factory,
  ): <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Retry>>;
} = (optionsOrFactory: Options | Factory) =>
  Effect.provide(Layer.succeed(Retry, optionsOrFactory));

/** Disables all automatic retries. */
export const none: <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, Exclude<R, Retry>> = Effect.provide(
  Layer.succeed(Retry, { while: () => false }),
);

/**
 * The default retry policy (core's): transient/throttling/retryable errors,
 * capped exponential backoff with jitter, server `retryAfter` hints honored
 * with precedence.
 */
export const makeDefault: Factory = Retries.makeDefault;

export const jittered = Retries.jittered;
export const capped = Retries.capped;

/** Retry options that retry all throttling errors indefinitely. */
export const throttlingOptions: Options = Retries.throttlingOptions;

/** Retries all throttling errors indefinitely (honoring server hints). */
export const throttling: <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, Exclude<R, Retry>> = policy(Retries.throttlingFactory);

/** Retry options that retry all transient errors indefinitely. */
export const transientOptions: Options = Retries.transientOptions;

/** Retries all transient errors indefinitely (honoring server hints). */
export const transient: <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, Exclude<R, Retry>> = policy(Retries.transientFactory);
