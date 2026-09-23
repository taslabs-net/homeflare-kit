/**
 * The four LiteLLM proxy calls a `LiteLLM.PassThroughEndpoint` needs, and nothing else reaches
 * LiteLLM's `/config/pass_through_endpoint` routes.
 *
 * ⛔ WRAPPED IN A PER-BASE-URL SEMAPHORE. LiteLLM stores every pass-through endpoint in ONE
 *   `general_settings.pass_through_endpoints` list (pass_through_endpoints.py at tag v1.100.0),
 *   so create/update/delete are each a read-modify-write of the WHOLE list through
 *   `update_config_general_settings`. Two of this package's own calls racing each other — two
 *   endpoints created in the same deploy — would each read the list, add their own row and write
 *   it back, and the second write would silently drop the first row. One permit per proxy
 *   serialises this package's own writes; it cannot serialise against the LiteLLM UI or a second
 *   deploy process, which is why `reconcile` reads back after writing rather than trusting the
 *   call that just returned (docs/litellm.md).
 * ★ `Authorization: Bearer <key>` — LiteLLM's own client uses it (litellm/proxy/client/cli, and
 *   every `/config/*` route decorator at the tag takes `user_api_key_dict = Depends(user_api_key_auth)`,
 *   which accepts a bearer token). Every mutation additionally requires the caller be
 *   PROXY_ADMIN (`update_config_general_settings`, proxy_server.py:16411 at the tag) — an
 *   ordinary virtual key gets `LitellmUnauthorizedError`, not a clearer 403 body naming the role.
 * ⛔ NO MESSAGE SNIFFING (S21). Every status this file maps becomes a typed tag; nothing here or
 *   above it matches an error body's text. Deleting an id LiteLLM does not have answers 400
 *   (measured against the tag's `pass_through_endpoint_delete` — the id is looked up in the list
 *   and a miss raises `HTTPException(400)`, not 404) — but so does a genuinely-live row when the
 *   caller isn't PROXY_ADMIN, or the DB is disconnected (`update_config_general_settings`,
 *   proxy_server.py:16389-16416 at the tag): the SAME status, for a delete that did NOT happen.
 *   `deletePassThroughEndpoint` tells them apart by re-listing (a GET, which needs no PROXY_ADMIN —
 *   proxy_server.py:3245-3251) rather than by the 400's body text — see its own comment.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import * as Semaphore from 'effect/Semaphore';
import { LitellmCredentials, type LitellmCredentialsError } from './credentials.ts';
import type {
  PassThroughEndpointResponse,
  PassThroughGenericEndpoint,
} from './generated/pass-through.ts';

export type LitellmRequirements = HttpClient.HttpClient | LitellmCredentials;

/**
 * The `litellm:<METHOD> <path>` operations this package writes to and reads from.
 *
 * ★ `codegen/litellm.ts` scans this FILE's text for these exact literals to pick which of
 *   LiteLLM 1.100.0's 696 paths to generate types from (codegen/litellm.ts header). Keep each one
 *   a literal string on one line; the generator matches text, it does not evaluate the object.
 */
export const LITELLM_OPERATIONS = {
  create: 'litellm:POST /config/pass_through_endpoint',
  delete: 'litellm:DELETE /config/pass_through_endpoint',
  list: 'litellm:GET /config/pass_through_endpoint',
  update: 'litellm:POST /config/pass_through_endpoint/{endpoint_id}',
} as const;

export class LitellmUnauthorizedError extends Data.TaggedError('LitellmUnauthorizedError')<{
  readonly status: number;
  readonly method: string;
  readonly path: string;
}> {}
export class LitellmBadRequestError extends Data.TaggedError('LitellmBadRequestError')<{
  readonly method: string;
  readonly path: string;
  readonly detail: string;
}> {}
export class LitellmHttpError extends Data.TaggedError('LitellmHttpError')<{
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly detail: string;
}> {}
export class LitellmTransportError extends Data.TaggedError('LitellmTransportError')<{
  readonly method: string;
  readonly path: string;
  readonly cause: string;
}> {}

export type LitellmError =
  | LitellmUnauthorizedError
  | LitellmBadRequestError
  | LitellmHttpError
  | LitellmTransportError
  | LitellmCredentialsError;

const semaphores = new Map<string, Semaphore.Semaphore>();

/** One semaphore per base URL, created on first use. Never `Hash.structure` (S18) — a plain Map key. */
const semaphoreFor = (baseUrl: string): Effect.Effect<Semaphore.Semaphore> =>
  Effect.sync(() => {
    const existing = semaphores.get(baseUrl);
    if (existing !== undefined) return existing;
    const created = Semaphore.makeUnsafe(1);
    semaphores.set(baseUrl, created);
    return created;
  });

const call = <T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) =>
  Effect.gen(function* () {
    const creds = yield* yield* LitellmCredentials;
    const client = yield* HttpClient.HttpClient;
    const url = `${creds.baseUrl}${path}`;
    const request = HttpClientRequest.make(method)(url).pipe(
      HttpClientRequest.setHeaders({
        Accept: 'application/json',
        Authorization: `Bearer ${creds.apiKey}`,
      }),
      body === undefined
        ? (self) => self
        : HttpClientRequest.bodyText(JSON.stringify(body), 'application/json'),
    );
    const response = yield* client
      .execute(request)
      .pipe(
        Effect.mapError(
          (cause) => new LitellmTransportError({ cause: String(cause), method, path }),
        ),
      );
    const text = yield* response.text.pipe(
      Effect.mapError((cause) => new LitellmTransportError({ cause: String(cause), method, path })),
    );
    if (response.status === 401 || response.status === 403) {
      return yield* Effect.fail(
        new LitellmUnauthorizedError({ method, path, status: response.status }),
      );
    }
    if (response.status === 400) {
      return yield* Effect.fail(
        new LitellmBadRequestError({ detail: text.slice(0, 300), method, path }),
      );
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new LitellmHttpError({ detail: text.slice(0, 300), method, path, status: response.status }),
      );
    }
    return (text === '' ? undefined : JSON.parse(text)) as T;
  });

/** GET /config/pass_through_endpoint — every row, config-file and DB alike. Not under the semaphore: reads don't race the field. */
export const listPassThroughEndpoints = (): Effect.Effect<
  readonly PassThroughGenericEndpoint[],
  LitellmError,
  LitellmRequirements
> =>
  call<PassThroughEndpointResponse>('GET', '/config/pass_through_endpoint').pipe(
    Effect.map((body) => body.endpoints),
  );

const mutate = <T>(io: Effect.Effect<T, LitellmError, LitellmRequirements>) =>
  Effect.gen(function* () {
    const creds = yield* yield* LitellmCredentials;
    const semaphore = yield* semaphoreFor(creds.baseUrl);
    return yield* semaphore.withPermits(1)(io);
  });

/** POST /config/pass_through_endpoint. `body` carries `id` — see pass-through-endpoint.ts. */
export const createPassThroughEndpoint = (
  body: PassThroughGenericEndpoint,
): Effect.Effect<void, LitellmError, LitellmRequirements> =>
  mutate(call('POST', '/config/pass_through_endpoint', body));

/** POST /config/pass_through_endpoint/{endpoint_id}. Merges with `exclude_none` — see pass-through-form.ts. */
export const updatePassThroughEndpoint = (
  endpointId: string,
  body: Partial<PassThroughGenericEndpoint>,
): Effect.Effect<void, LitellmError, LitellmRequirements> =>
  mutate(call('POST', `/config/pass_through_endpoint/${encodeURIComponent(endpointId)}`, body));

/**
 * DELETE /config/pass_through_endpoint?endpoint_id=… — idempotent BY THIS FUNCTION, not by the
 * vendor. ⚠️ Measured at v1.100.0: deleting an id the list does not have raises `HTTPException(400)`
 * from `pass_through_endpoint_delete` — but the SAME route also 400s `not_allowed_access` for a
 * non-PROXY_ADMIN caller or a disconnected DB (`update_config_general_settings`,
 * proxy_server.py:16389-16416), on a row that never got deleted. A 400 alone cannot tell the two
 * apart, so THIS FUNCTION DOESN'T GUESS FROM THE STATUS ALONE: on 400 it re-lists (a GET — no
 * PROXY_ADMIN required, proxy_server.py:3245-3251) and only treats the delete as already-done if
 * `endpointId` is genuinely absent; otherwise the delete failed and this re-fails with the ORIGINAL
 * error, not a message match (S21 — a status-and-a-real-read decision, never body text).
 */
export const deletePassThroughEndpoint = (
  endpointId: string,
): Effect.Effect<void, LitellmError, LitellmRequirements> =>
  mutate(
    call(
      'DELETE',
      `/config/pass_through_endpoint?endpoint_id=${encodeURIComponent(endpointId)}`,
    ).pipe(
      Effect.catchTag('LitellmBadRequestError', (original) =>
        Effect.gen(function* () {
          const rows = yield* listPassThroughEndpoints();
          if (rows.some((row) => row.id === endpointId)) return yield* Effect.fail(original);
        }),
      ),
      Effect.asVoid,
    ),
  );
