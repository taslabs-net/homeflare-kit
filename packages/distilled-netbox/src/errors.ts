/**
 * NetBox-specific error types.
 *
 * Re-exports the common HTTP errors from core and adds the NetBox-specific
 * unknown-error and parse-error wrappers.
 *
 * NetBox (Django REST Framework) has no single failure envelope: a 403/404
 * answers `{ detail: "..." }`, a 400 validation failure answers a flat
 * object keyed by field name (or `non_field_errors`) with an array of
 * messages per field, and a reverse-proxy 502/504 in front of a down
 * instance answers an HTML page that is not JSON at all. There is no
 * machine-readable code anywhere, so the SDK dispatches on the HTTP status:
 * the per-operation classes generated from each operation's declared
 * responses (`NotFound`, `Forbidden`, `BadRequest`, `Conflict`, …) first —
 * including the ones `patches/<tag>/_undeclared-errors.json` adds, since
 * NetBox's own OpenAPI document omits 404/403/400 almost everywhere despite
 * every DRF ModelViewSet producing them uniformly — then core's shared
 * status map (which is where an undeclared 502 lands, as `BadGateway`),
 * then {@link UnknownNetboxError}.
 */
export {
  BadGateway,
  BadRequest,
  Conflict,
  ConfigError,
  Forbidden,
  GatewayTimeout,
  InternalServerError,
  Locked,
  NotFound,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
  HTTP_STATUS_MAP,
  DEFAULT_ERRORS,
  API_ERRORS,
} from "@distilled.cloud/core/errors";
import type { DefaultErrors as CoreDefaultErrors } from "@distilled.cloud/core/errors";

import * as Schema from "effect/Schema";
import * as Category from "@distilled.cloud/core/category";

/**
 * Unknown NetBox error — returned when a failed response's HTTP status has
 * no mapped error class. Carries the raw body for later cataloging; the body
 * is the raw HTML text (not parsed JSON) when a reverse proxy answered
 * instead of NetBox itself.
 */
export class UnknownNetboxError extends Schema.TaggedError<UnknownNetboxError>()(
  "UnknownNetboxError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class NetboxParseError extends Schema.TaggedError<NetboxParseError>()(
  "NetboxParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * Errors any NetBox operation may surface in addition to the per-operation
 * typed status errors.
 */
export type ClientErrors = UnknownNetboxError | NetboxParseError;

/**
 * Default NetBox operation errors: the shared HTTP status errors from core
 * plus the client-level fallback/decode errors.
 */
export type DefaultErrors = CoreDefaultErrors | ClientErrors;
