/**
 * UniFi Network-specific error types.
 *
 * ⛔ NO OPERATION DOCUMENTS AN ERROR RESPONSE. Every one of the 73 operations
 * in `network_v10.4.57_openapi.json` declares only its success status (65
 * carry `200`, 8 carry `201`) — there is no per-operation 4xx/5xx, and
 * unlike Hetzner's spec there isn't even a blanket `4xx`/`5xx` wildcard to
 * signal "any of these can happen." So there is nothing for the OpenAPI→
 * Smithy converter to type per operation (see `scripts/convert.ts`'s
 * `statusToErrorClass: {}`), and every generated operation's error channel
 * is the SAME open set below, dispatched purely by HTTP status at runtime
 * (`src/protocol.ts`, `@distilled.cloud/core/errors#HTTP_STATUS_MAP`) —
 * exactly the situation core's shared map exists for, just with less
 * upstream signal than usual to say which statuses are actually reachable.
 *
 * The FAILURE BODY *is* documented, though, just never `$ref`'d from an
 * operation: `components.schemas["Error Message"]` (`{code, message,
 * requestId, requestPath, statusCode, statusName, timestamp}`, T8) sits in
 * the pinned spec with zero references. `src/protocol.ts`'s `errorEnvelope`
 * decodes it, so `message` below is the vendor's own text instead of a bare
 * `HTTP <status>`. `UnknownUnifiNetworkError` carries the matching
 * `requestId`/`statusCode`/`statusName` alongside the raw `body` — every
 * field from that schema EXCEPT `requestPath`, which is dropped rather than
 * surfaced as a first-class field (T3: like the console id/endpoint in
 * `src/credentials.ts`, a request path is caller/console-shaped and must
 * never end up somewhere it gets logged as if it were plain diagnostic
 * text; it is still present, un-plucked, inside `body` for anyone who reads
 * that raw value on purpose).
 *
 * Re-exports the common HTTP errors from core (nothing UniFi-specific to
 * add to the status→class mapping) plus the unknown-error and parse-error
 * wrappers every package needs.
 *
 * Known unknowns — confirm against a live console before hardening on them:
 *   - The `Error Message` schema itself, UNCONFIRMED by any real capture yet
 *     (no live call has been made against a console for this work — T8/T16).
 *   - Whether 429 carries `Retry-After` (assume not; see `src/retry.ts`).
 *   - Whether a bad/missing `X-API-KEY` answers 401 or 403 (both are wired
 *     through `HTTP_STATUS_MAP`; only one will actually fire).
 */
export {
  BadGateway,
  BadRequest,
  Conflict,
  ConfigError,
  Forbidden,
  GatewayTimeout,
  InternalServerError,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
  HTTP_STATUS_MAP,
  DEFAULT_ERRORS,
  API_ERRORS,
} from "@distilled.cloud/core/errors";
import type {
  BadRequest as CoreBadRequest,
  Conflict as CoreConflict,
  DefaultErrors as CoreDefaultErrors,
  Forbidden as CoreForbidden,
  NotFound as CoreNotFound,
  UnprocessableEntity as CoreUnprocessableEntity,
} from "@distilled.cloud/core/errors";

import * as Schema from "effect/Schema";
import * as Category from "@distilled.cloud/core/category";

/**
 * Unknown UniFi Network error — returned when a failed response's HTTP
 * status has no mapped error class (every status `HTTP_STATUS_MAP` does
 * cover surfaces as that mapped class instead, e.g. `NotFound`, and only
 * carries `message` — core's classes are shared across every provider and
 * are never given UniFi-specific fields). `code`/`requestId`/`statusCode`/
 * `statusName`/`timestamp` come from the vendor's own `Error Message` envelope
 * (`src/protocol.ts`'s `errorEnvelope`, T8) when the failure body parsed as
 * JSON in that shape; `requestPath` is deliberately NOT modeled as a field
 * here (T3) — see the module doc comment. `body` carries the raw parsed
 * JSON (or raw text) for later cataloging regardless of whether it matched
 * the envelope shape.
 */
export class UnknownUnifiNetworkError extends Schema.TaggedError<UnknownUnifiNetworkError>()(
  "UnknownUnifiNetworkError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    requestId: Schema.optional(Schema.String),
    statusCode: Schema.optional(Schema.Number),
    statusName: Schema.optional(Schema.String),
    timestamp: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class UnifiNetworkParseError extends Schema.TaggedError<UnifiNetworkParseError>()(
  "UnifiNetworkParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * Errors any UniFi Network operation may surface in addition to the shared
 * HTTP status errors.
 */
export type ClientErrors = UnknownUnifiNetworkError | UnifiNetworkParseError;

/**
 * Default UniFi Network operation errors.
 *
 * EVERY operation carries the whole set — the spec types no failure at all,
 * per-operation or wildcard, so the error channel says a `404` (site or
 * object not found), `400` (a malformed whole-object PUT — see the
 * package README) or `409` is possible on any call rather than pretending
 * only the statuses core marks "default" (401/429/5xx) can happen.
 */
export type DefaultErrors =
  | CoreDefaultErrors
  | CoreBadRequest
  | CoreForbidden
  | CoreNotFound
  | CoreConflict
  | CoreUnprocessableEntity
  | ClientErrors;
