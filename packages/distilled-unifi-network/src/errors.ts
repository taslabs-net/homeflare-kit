/**
 * UniFi Network-specific error types.
 *
 * ⛔ THE SPEC DOCUMENTS ZERO ERROR RESPONSES. Every one of the 73 operations
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
 * Re-exports the common HTTP errors from core (nothing UniFi-specific to
 * add to the status→class mapping — no documented error envelope shape,
 * either, so `UnknownUnifiNetworkError` below carries the raw body rather
 * than any parsed `code`/`message` pair) plus the unknown-error and
 * parse-error wrappers every package needs.
 *
 * Known unknowns — confirm against a live console before hardening on them:
 *   - Exact body shape of a failure (no operation's `responses` gives one).
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
 * status has no mapped error class, OR (given the spec's total silence on
 * error shapes) as the fallback for any status this SDK has not been told
 * about by a real failure yet. Carries the raw body for later cataloging.
 */
export class UnknownUnifiNetworkError extends Schema.TaggedError<UnknownUnifiNetworkError>()(
  "UnknownUnifiNetworkError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
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
