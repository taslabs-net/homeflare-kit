/**
 * Paperless-ngx-specific error types.
 *
 * Re-exports the common HTTP errors from core and adds the Paperless-ngx-
 * specific unknown-error and parse-error wrappers.
 *
 * Paperless-ngx (Django REST Framework) has no single failure envelope: a
 * 403/404 answers `{ detail: "..." }`, a 400 validation failure answers a
 * flat object keyed by field name (or `non_field_errors`) with an array of
 * messages per field, and a reverse-proxy 502/504 in front of a down
 * instance answers an HTML page that is not JSON at all — the same three
 * shapes NetBox's identical DRF stack produces (see NetBox's own errors.ts
 * for the cross-reference). There is no machine-readable code anywhere, so
 * the SDK dispatches on the HTTP status: the per-operation classes generated
 * from each operation's declared responses (`NotFound`, `Forbidden`,
 * `BadRequest`, …) first — including the ones
 * `patches/<tag>/_undeclared-errors.json` add, since the pinned v3.1.1
 * document declares only the success response almost everywhere — then
 * core's shared status map (which is where an undeclared 502 lands, as
 * `BadGateway`), then {@link UnknownPaperlessNgxError}.
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
 * Unknown Paperless-ngx error — returned when a failed response's HTTP
 * status has no mapped error class. Carries the raw body for later
 * cataloging; the body is the raw HTML text (not parsed JSON) when a
 * reverse proxy answered instead of Paperless-ngx itself.
 */
export class UnknownPaperlessNgxError extends Schema.TaggedError<UnknownPaperlessNgxError>()(
  "UnknownPaperlessNgxError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class PaperlessNgxParseError extends Schema.TaggedError<PaperlessNgxParseError>()(
  "PaperlessNgxParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * Errors any Paperless-ngx operation may surface in addition to the
 * per-operation typed status errors.
 */
export type ClientErrors = UnknownPaperlessNgxError | PaperlessNgxParseError;

/**
 * Default Paperless-ngx operation errors: the shared HTTP status errors from
 * core plus the client-level fallback/decode errors.
 */
export type DefaultErrors = CoreDefaultErrors | ClientErrors;
