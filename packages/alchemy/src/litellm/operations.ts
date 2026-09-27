/**
 * The four LiteLLM `/config/pass_through_endpoint*` calls this package writes to and reads from —
 * now through `@distilled.cloud/litellm`'s typed operations (S23), not a hand-rolled `HttpClient`
 * client. `client.ts` is retired; nothing else in this package imported it.
 *
 * ⛔ STILL WRAPPED IN A PER-BASE-URL SEMAPHORE, UNCHANGED FROM `client.ts`. LiteLLM stores every
 *   pass-through endpoint in ONE `general_settings.pass_through_endpoints` list
 *   (`pass_through_endpoints.py` at tag v1.100.0, mirrored in the SDK's own `misc.ts` docstrings),
 *   so create/update/delete are each a read-modify-write of the WHOLE list through
 *   `update_config_general_settings`. Two of this package's own calls racing each other — two
 *   endpoints created in the same deploy — would each read the list, add their own row and write
 *   it back, and the second write would silently drop the first row. The SDK has no opinion on
 *   this: it is a quirk of how THIS vendor stores the resource, not a distilled protocol concern,
 *   so it stays here, one layer above the typed calls. One permit per proxy serialises this
 *   package's own writes; it cannot serialise against the LiteLLM UI or a second deploy process,
 *   which is why `pass-through-endpoint.ts`'s `reconcile` reads back after writing rather than
 *   trusting the call that just returned (docs/litellm.md).
 * ⛔ NO STATUS SNIFFING (S21). Every failure the SDK's own typed operations declare — `BadRequest`
 *   (400), `NotFound` (404 on update only), `UnprocessableEntity` (422) plus the shared
 *   `Unauthorized`/`TooManyRequests`/`InternalServerError`/`BadGateway`/`ServiceUnavailable`/
 *   `GatewayTimeout` every operation carries — is a distilled patch's doing
 *   (`@distilled.cloud/litellm`'s own `patches/misc/*.json`, applied at generation time), never a
 *   status check here or in `pass-through-endpoint.ts`. Deleting an id LiteLLM does not have
 *   answers `BadRequest` (measured against the tag's `pass_through_endpoint_delete` — the id is
 *   looked up in the list and a miss raises `HTTPException(400)`, not 404) — but so does a
 *   genuinely-live row when the caller isn't PROXY_ADMIN, or the DB is disconnected. Telling those
 *   apart by re-listing, not by the `BadRequest`'s message text, is `pass-through-endpoint.ts`'s
 *   `deletePassThroughEndpoint`'s own job (S21 — a status-and-a-real-read decision, never body
 *   text) — this file only forwards the typed error.
 */
import * as misc from '@distilled.cloud/litellm/misc';
import { Credentials } from '@distilled.cloud/litellm/Credentials';
import type { LitellmOpContext } from '@distilled.cloud/litellm/Protocol';
import type { ConfigError } from '@distilled.cloud/litellm/Errors';
import * as Effect from 'effect/Effect';
import * as Semaphore from 'effect/Semaphore';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

export type { LitellmOpContext } from '@distilled.cloud/litellm/Protocol';
export type LitellmRequirements = LitellmOpContext;
export type {
  PassThroughEndpointResponse,
  PassThroughGenericEndpoint,
  PassThroughGuardrailSettings,
} from '@distilled.cloud/litellm/misc';

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

/**
 * Serialises a write against this call's own base URL — see the file header.
 *
 * ⚠️ `Credentials` itself ends in `Effect.orDie` on a missing/misspelled env var (Q6, decision
 *   49 "upstream wins", 2026-09-24, matching distilled's own convention — 73 of 80 packages'
 *   `credentials.ts` do the same at `homeflare/base`), so resolving it here can no longer fail
 *   typed. The `| ConfigError` this function still adds to its return type stays only because
 *   `@distilled.cloud/litellm`'s own `LitellmOpError` (protocol.ts) unconditionally declares
 *   `ConfigError` as a member of every generated operation's error union regardless of
 *   `Credentials`'s own type — so `E` (the wrapped operation's error) already contains it, and
 *   this widening is a genuine no-op for callers, not dead type-state left over from the revert.
 */
/**
 * ⛔ THE STACK'S AMBIENT `HttpClient` MAY BE CADDY'S. `caddyProviders()` provideMerges a client
 *   that dials the admin listener and ignores the request host (`caddy-http-client.ts`). Measured
 *   2026-09-25: that client answers `GET /config/pass_through_endpoint` with HTTP 200 `null`
 *   (Caddy's empty-config body). The decoded value then has no `endpoints`, and `locate` throws
 *   `rows.find` of undefined. FetchHttpClient uses the URL the LiteLLM protocol built. An outer
 *   `Fetch` service still wins inside that client, which is how the fake proxy stays the test
 *   transport.
 */
const throughFetch = <A, E, R>(io: Effect.Effect<A, E, R>) =>
  io.pipe(Effect.provide(FetchHttpClient.layer));

const mutate = <A, E>(
  io: Effect.Effect<A, E, LitellmOpContext>,
): Effect.Effect<A, E | ConfigError, LitellmOpContext> =>
  Effect.gen(function* () {
    const resolve = yield* Credentials;
    const creds = yield* resolve;
    const semaphore = yield* semaphoreFor(creds.apiBaseUrl);
    return yield* semaphore.withPermits(1)(throughFetch(io));
  });

const endpointsOf = (
  response: misc.PassThroughEndpointResponse,
): Effect.Effect<readonly misc.PassThroughGenericEndpoint[]> => {
  const rows = response.endpoints;
  if (!Array.isArray(rows)) {
    return Effect.die(
      new Error(
        'GET /config/pass_through_endpoint decoded no endpoints array. The call reached something other than the LiteLLM proxy.',
      ),
    );
  }
  return Effect.succeed(rows);
};

/** GET /config/pass_through_endpoint — every row, config-file and DB alike. Not under the semaphore: reads don't race the field. */
export const listPassThroughEndpoints = (): Effect.Effect<
  readonly misc.PassThroughGenericEndpoint[],
  misc.GetPassThroughEndpointsConfigPassThroughEndpointGetError,
  LitellmOpContext
> =>
  throughFetch(misc.getPassThroughEndpointsConfigPassThroughEndpointGet({})).pipe(
    Effect.flatMap(endpointsOf),
  );

/** POST /config/pass_through_endpoint. `body` carries `id` — see pass-through-form.ts. */
export const createPassThroughEndpoint = (
  body: misc.PassThroughGenericEndpoint,
): Effect.Effect<
  void,
  misc.CreatePassThroughEndpointsConfigPassThroughEndpointPostError,
  LitellmOpContext
> => mutate(misc.createPassThroughEndpointsConfigPassThroughEndpointPost(body).pipe(Effect.asVoid));

/**
 * POST /config/pass_through_endpoint/{endpoint_id}. Merges with `exclude_none` — see
 * pass-through-form.ts. `body` is `pass-through-form.ts`'s own `UpdateBody`, not a blanket
 * `Partial<>` — `path`/`target` are the two fields the SDK's request type still requires
 * non-optionally on an update.
 */
export const updatePassThroughEndpoint = (
  endpointId: string,
  body: Partial<Omit<misc.PassThroughGenericEndpoint, 'path' | 'target'>> &
    Pick<misc.PassThroughGenericEndpoint, 'path' | 'target'>,
): Effect.Effect<
  void,
  misc.UpdatePassThroughEndpointsConfigPassThroughEndpointEndpointIdPostError,
  LitellmOpContext
> =>
  mutate(
    misc
      .updatePassThroughEndpointsConfigPassThroughEndpointEndpointIdPost({
        ...body,
        endpoint_id: endpointId,
      })
      .pipe(Effect.asVoid),
  );

/**
 * DELETE /config/pass_through_endpoint?endpoint_id=… — idempotent BY THIS FUNCTION, not by the
 * vendor. ⚠️ Measured at v1.100.0: deleting an id the list does not have raises `HTTPException(400)`
 * from `pass_through_endpoint_delete`, which the SDK decodes as a typed `BadRequest` — but the SAME
 * route also raises the SAME `BadRequest` for `not_allowed_access` (a non-PROXY_ADMIN caller) or a
 * disconnected DB, on a row that never got deleted. A `BadRequest` alone cannot tell the two apart,
 * so THIS FUNCTION DOESN'T GUESS FROM THE TAG ALONE: on `BadRequest` it re-lists (a GET — no
 * PROXY_ADMIN required) and only treats the delete as already-done if `endpointId` is genuinely
 * absent; otherwise the delete failed and this re-fails with the ORIGINAL error, not a message
 * match (S21 — a status-and-a-real-read decision, never body text).
 */
export const deletePassThroughEndpoint = (
  endpointId: string,
): Effect.Effect<
  void,
  misc.DeletePassThroughEndpointsConfigPassThroughEndpointDeleteError,
  LitellmOpContext
> =>
  mutate(
    misc
      .deletePassThroughEndpointsConfigPassThroughEndpointDelete({ endpoint_id: endpointId })
      .pipe(
        Effect.asVoid,
        Effect.catchTag('BadRequest', (original) =>
          Effect.gen(function* () {
            const rows = yield* listPassThroughEndpoints();
            if (rows.some((row) => row.id === endpointId)) return yield* Effect.fail(original);
          }),
        ),
      ),
  );
