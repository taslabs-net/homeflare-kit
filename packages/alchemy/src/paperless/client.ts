/**
 * One authenticated call to the Paperless-ngx REST API at `/api`.
 *
 * ⚠️ `Authorization: Token <value>`, NOT `Bearer`. Paperless-ngx's `securitySchemes.tokenAuth`
 *   (the v3.1.1 served schema) states the "Token" prefix explicitly — the same DRF
 *   `TokenAuthentication` NetBox uses (netbox/client.ts), a different vendor, same convention.
 *
 * ⛔ `Accept: application/json; version=10` ON EVERY CALL. Paperless-ngx versions its API with
 *   DRF's `AcceptHeaderVersioning` (`REST_FRAMEWORK.DEFAULT_VERSION = '10'`, measured against the
 *   v3.1.1 source). Omitting the header still answers — DRF falls back to `DEFAULT_VERSION` — but
 *   pinning it here means an estate upgrade that moves the default cannot silently change what
 *   this package receives without a version bump of its own noticing.
 *
 * ⚠️ A LIST IS WRAPPED, A DETAIL IS NOT: `{count, next, previous, results: […]}` vs. the bare
 *   object — the same DRF pagination shape NetBox uses.
 */
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { PaperlessCredentials, type PaperlessCredentialsError } from './credentials.ts';
import { type PaperlessError, PaperlessUnavailable, statusToError } from './errors.ts';

const PATH_PREFIX = '/api';
const API_VERSION = '10';

export interface PaperlessList<T> {
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly T[];
}

export type PaperlessRow = Record<string, unknown>;

/**
 * ⚠️ `PaperlessCredentials` IS PART OF THIS, NOT JUST `HttpClient`. `paperless()` reads the lazy
 *   credentials service (`yield* yield* PaperlessCredentials`), so a stack that wires the
 *   providers without also providing a credentials layer should fail to TYPECHECK, not fail at
 *   the first call. `providers.ts` supplies `environmentLayer` by default for exactly this.
 */
export type PaperlessRequirements = HttpClient.HttpClient | PaperlessCredentials;

/** One JSON call. Returns the parsed body, or `undefined` for an empty response (DELETE). */
export const paperless = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Effect.Effect<T, PaperlessError | PaperlessCredentialsError, PaperlessRequirements> =>
  Effect.gen(function* () {
    const credentials = yield* yield* PaperlessCredentials;
    const url = `${credentials.url}${PATH_PREFIX}/${path.replace(/^\//, '')}`;
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.make(method)(url).pipe(
      HttpClientRequest.setHeaders({
        Accept: `application/json; version=${API_VERSION}`,
        Authorization: `Token ${credentials.token}`,
      }),
      // ⛔ Content-Type on `bodyText`, not the header map — `bodyText(s)` with no second argument
      //   sets `text/plain` and overwrites a `Content-Type` set earlier via `setHeaders`, because
      //   it is piped afterwards (measured against `@homeflare/alchemy/forgejo`, netbox/client.ts).
      body === undefined
        ? (self) => self
        : HttpClientRequest.bodyText(JSON.stringify(body), 'application/json'),
    );
    const response = yield* client
      .execute(request)
      .pipe(
        Effect.mapError(
          (cause) => new PaperlessUnavailable({ detail: String(cause), method, path, status: 0 }),
        ),
      );
    if (response.status < 200 || response.status >= 300) {
      const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ''));
      return yield* Effect.fail(statusToError(response.status, method, path, detail.slice(0, 500)));
    }
    const text = yield* response.text.pipe(
      Effect.mapError(
        () =>
          new PaperlessUnavailable({
            detail: 'body read failed',
            method,
            path,
            status: response.status,
          }),
      ),
    );
    return (text === '' ? undefined : JSON.parse(text)) as T;
  });
