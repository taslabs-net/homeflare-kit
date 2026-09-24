/**
 * Turning a distilled `@distilled.cloud/caddy` operation failure into a readable refusal — shared
 * by config-lifecycle.ts and config-reconcile.ts, so both read the same way.
 */
import * as Effect from 'effect/Effect';
import type * as Caddy from '@distilled.cloud/caddy';
import { isUnreachable } from './caddy-http-client.ts';

export const refuse = (endpoint: string, message: string): Error =>
  new Error(`Caddy.Config at ${endpoint}: ${message}`);

export const short = (digest: string): string => digest.slice(0, 12);

/** Every `CaddyOpError` member carries `.message` (a `Schema.TaggedError` field) — see errors.ts. */
export const messageOf = (error: Caddy.CaddyOpError): string =>
  'message' in error && typeof error.message === 'string' ? error.message : String(error);

/**
 * A distilled operation's typed failure, read the way this resource's own refusals read:
 * `LoadRefused` (the 200-embedded-error trap admin-calls.ts's module doc describes) says so
 * explicitly, so a grep for "kept the previous config" is never mistaken for an ordinary 4xx/5xx.
 */
export const operationFailure = (endpoint: string, op: string, error: Caddy.CaddyOpError): Error =>
  error._tag === 'LoadRefused'
    ? refuse(
        endpoint,
        `Caddy refused the Caddyfile (${error._tag}, a 200 whose body carried the error, not a ` +
          `failure status) — ${error.message}`,
      )
    : refuse(endpoint, `${op} failed (${error._tag}) — ${messageOf(error)}`);

/**
 * Humanizes every failure from a distilled operation EXCEPT one nothing accepted the connection
 * for — that stays the raw, still-typed `HttpClientError` so config.ts's plan-time escape hatch
 * (`Effect.catchIf(isUnreachable, …)`) can keep narrowing to it after this wrapping, the same way
 * it could inspect the un-wrapped error before this function ran.
 */
export const wrapOperation =
  (endpoint: string, op: string) =>
  <A>(
    effect: Effect.Effect<A, Caddy.CaddyOpError, Caddy.CaddyOpContext>,
  ): Effect.Effect<A, Error | Caddy.CaddyOpError, Caddy.CaddyOpContext> =>
    effect.pipe(
      Effect.mapError((error) =>
        isUnreachable(error) ? error : operationFailure(endpoint, op, error),
      ),
    );
