/**
 * An Effect `HttpClient.HttpClient` over `node:http`, dialling a unix socket or loopback TCP
 * directly — the SDK's own transport layer for `@distilled.cloud/caddy`'s typed operations.
 *
 * ★ node:http, NOT `effect/unstable/http/FetchHttpClient`. MEASURED 2026-09-21 on bun 1.4.0 and
 *   node 26.7.0 (local-admin.ts's history): node:http dials a unix socket on BOTH runtimes, while
 *   node's fetch has no `unix` option at all (only Bun's does) — `@effect/platform-node`'s own
 *   `FetchHttpClient`/`NodeHttpClient.makeNodeHttp` (node:http, but URL-only — no `socketPath` seam)
 *   cannot speak a unix socket either. The published dist loads under node too (launchd's
 *   local-runner.ts makes the same call for the same reason), so this stays runtime-agnostic.
 * ★ A CONNECTION NOTHING ACCEPTED IS RETRIED; ONE CADDY ALREADY SAW IS NEVER RE-SENT. Only
 *   `ECONNREFUSED` (nothing listening) and `ENOENT` (no unix socket file yet) mean the request
 *   never reached Caddy — a launchd job bootstrapped a moment ago. Anything else (a reset, a
 *   timeout) may have reached Caddy, so `POST /load` is never resent for it: `isUnreachable`
 *   (local-admin.ts) is what tells `Caddy.Config`'s plan-time read to proceed without Caddy instead
 *   of failing the whole plan (config.ts's `planWithoutCaddy`).
 */
import * as http from 'node:http';
import { Readable } from 'node:stream';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Result from 'effect/Result';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientError from 'effect/unstable/http/HttpClientError';
import type * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import type { Target } from './admin-address.ts';

export type LocalHttpClientOptions = {
  /**
   * Abort an exchange after this long. @default 60_000
   * ⚠️ A `shutdown_delay` in the Caddyfile makes `/load` block that long (caddyhttp app.go Stop);
   *   a timeout then fails the deploy while Caddy goes on to apply — the next plan converges.
   */
  readonly timeoutMs?: number;
  /** Retries when the connection is REFUSED — see the module doc. @default 2 */
  readonly retries?: number;
  /** @default 500 */
  readonly retryDelayMs?: number;
};

const NEVER_CONNECTED = new Set(['ECONNREFUSED', 'ENOENT']);

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;

/**
 * Nothing accepted the connection — see the module doc's ★. A type guard, not just a predicate, so
 * config-lifecycle.ts's error-wrapping can pass through the raw error unchanged (still typed) and
 * config.ts's plan-time escape hatch (`Effect.catchIf`) narrows to it directly.
 */
export const isUnreachable = (error: unknown): error is HttpClientError.HttpClientError =>
  error instanceof HttpClientError.HttpClientError &&
  error.reason._tag === 'TransportError' &&
  NEVER_CONNECTED.has(codeOf(error.reason.cause) ?? '');

const transportFailure = (request: HttpClientRequest.HttpClientRequest, cause: unknown) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, cause }),
  });

/** Node's response headers (string | string[] | undefined) → the single-valued form Web `Response` wants. Caddy never repeats a header this transport reads. */
const flattenHeaders = (headers: http.IncomingHttpHeaders): Record<string, string> => {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) flat[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
};

const waitForResponse = (
  nodeRequest: http.ClientRequest,
  request: HttpClientRequest.HttpClientRequest,
) =>
  Effect.callback<http.IncomingMessage, HttpClientError.HttpClientError>((resume) => {
    const onError = (cause: Error): void => {
      resume(Effect.fail(transportFailure(request, cause)));
    };
    nodeRequest.on('error', onError);
    const onResponse = (response: http.IncomingMessage): void => {
      nodeRequest.off('error', onError);
      resume(Effect.succeed(response));
    };
    nodeRequest.on('response', onResponse);
    return Effect.sync(() => {
      nodeRequest.off('error', onError);
      nodeRequest.off('response', onResponse);
    });
  });

const waitForFinish = (
  nodeRequest: http.ClientRequest,
  request: HttpClientRequest.HttpClientRequest,
) =>
  Effect.callback<void, HttpClientError.HttpClientError>((resume) => {
    const onError = (cause: Error): void => {
      resume(Effect.fail(transportFailure(request, cause)));
    };
    nodeRequest.once('error', onError);
    const onFinish = (): void => {
      nodeRequest.off('error', onError);
      resume(Effect.void);
    };
    nodeRequest.once('finish', onFinish);
    return Effect.sync(() => {
      nodeRequest.off('error', onError);
      nodeRequest.off('finish', onFinish);
    });
  });

/**
 * Every Caddy operation's request body is `Empty` (GET/DELETE/`/stop`) or a `Uint8Array` — the
 * `T.HttpBody()`/JSON-body cascade never produces `Raw`, `FormData` or `Stream` for this SDK
 * (protocol.ts). A typed refusal, not a defect (S20), for a body shape that would mean the SDK grew
 * an operation this transport was never taught to send.
 */
const sendBody = (
  nodeRequest: http.ClientRequest,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<void, HttpClientError.HttpClientError> =>
  Effect.suspend(() => {
    const body = request.body;
    if (body._tag === 'Empty') {
      nodeRequest.end();
      return waitForFinish(nodeRequest, request);
    }
    if (body._tag === 'Uint8Array') {
      // ⚠️ `body.contentLength` is never nullish, so `?? body.body.byteLength` reads as dead code
      //   to TypeScript's `??` narrowing — which then (a real quirk, not a defect here) infers
      //   `body` itself as `never` on that unreachable side. Two plain statements instead.
      nodeRequest.setHeader('content-length', body.contentLength);
      nodeRequest.end(body.body);
      return waitForFinish(nodeRequest, request);
    }
    return Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.EncodeError({
          request,
          description: `Caddy admin transport: unsupported request body "${body._tag}" — every Caddy operation sends Empty or a Uint8Array body`,
        }),
      }),
    );
  });

const toWebResponse = (source: http.IncomingMessage): Response =>
  new Response(Readable.toWeb(source) as unknown as ReadableStream, {
    headers: flattenHeaders(source.headers),
    status: source.statusCode ?? 0,
  });

const exchangeOnce = (
  target: Target,
  request: HttpClientRequest.HttpClientRequest,
  url: URL,
  signal: AbortSignal,
  timeoutMs: number,
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
  Effect.suspend(() => {
    const nodeRequest = http.request({
      headers: request.headers,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      signal,
      timeout: timeoutMs,
      ...(target.kind === 'unix'
        ? { socketPath: target.socketPath }
        : { host: target.host, port: target.port }),
    });
    // node:http's own inactivity timeout — a hang (e.g. a `shutdown_delay` blocking `/load`, see
    // the module doc) destroys the request, which then surfaces through the same 'error' handler
    // `waitForResponse`/`waitForFinish` already listen on.
    nodeRequest.on('timeout', () => {
      nodeRequest.destroy(new Error(`no answer in ${String(timeoutMs)} ms`));
    });
    return Effect.raceFirst(
      waitForResponse(nodeRequest, request),
      sendBody(nodeRequest, request).pipe(Effect.andThen(Effect.never)),
    ).pipe(
      Effect.onError(() => Effect.sync(() => nodeRequest.destroy())),
      Effect.map((source) => HttpClientResponse.fromWeb(request, toWebResponse(source))),
    );
  });

/**
 * Retry ONLY a connection nothing accepted, up to `retries` times, spaced `retryDelayMs` apart —
 * a plain loop over `Effect.result`, not `Effect.retry`'s `{schedule, times, while}` options
 * object. MEASURED 2026-09-23: with a `Schedule` given alongside `times`/`while`, that combined
 * form retried an ECONNRESET past both — `while` kept correctly returning `false` every attempt,
 * logged and confirmed, yet the schedule's own unbounded `spaced` kept driving retries anyway. A
 * loop leaves no such ambiguity: the SAME `isUnreachable` check that would gate `while` here gates
 * every iteration directly, one attempt at a time.
 */
const withUnreachableRetry = (
  attempt: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
  retries: number,
  retryDelayMs: number,
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
  Effect.gen(function* () {
    let attemptsLeft = retries;
    for (;;) {
      const outcome = yield* Effect.result(attempt);
      if (Result.isSuccess(outcome)) return outcome.success;
      if (attemptsLeft <= 0 || !isUnreachable(outcome.failure)) {
        return yield* Effect.fail(outcome.failure);
      }
      attemptsLeft -= 1;
      yield* Effect.sleep(Duration.millis(retryDelayMs));
    }
  });

/** The transport `localCaddyAdmin()` provides as `HttpClient.HttpClient` — see local-admin.ts. */
export const makeLocalHttpClient = (
  target: Target,
  options: LocalHttpClientOptions = {},
): Layer.Layer<HttpClient.HttpClient> => {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 500;
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url, signal) => {
      const attempt = exchangeOnce(target, request, url, signal, timeoutMs);
      return retries <= 0 ? attempt : withUnreachableRetry(attempt, retries, retryDelayMs);
    }),
  );
};
