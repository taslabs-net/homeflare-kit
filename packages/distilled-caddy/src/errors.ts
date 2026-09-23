/**
 * Caddy-specific error types.
 *
 * Re-exports the common HTTP status errors from core (caddyserver/caddy
 * v2.11.4 admin.go `APIError{HTTPStatus, Message}` marshals as exactly
 * `{"error": "…"}` — matched by `errorEnvelope` in protocol.ts, which reads
 * that "error" key the way core's DEFAULT envelope already does) and adds
 * the two statuses core's `HTTP_STATUS_MAP` does not cover, plus Caddy's own
 * client-level fallbacks.
 *
 * - 405 Method Not Allowed: every admin route returns this on the wrong verb
 *   (admin.go `handleConfig`/`handleStop`, caddyconfig/load.go `handleLoad`/
 *   `handleAdapt` — each checks `r.Method` first and answers
 *   `APIError{HTTPStatus: http.StatusMethodNotAllowed}`).
 * - 412 Precondition Failed: `POST|PUT|PATCH|DELETE /config/…` with a stale
 *   `If-Match` (admin.go `changeConfig`, referenced from the docs' "Using
 *   Etag/If-Match" optimistic-concurrency section — see protocol.ts).
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

/** 405 — wrong HTTP method for an admin route. */
export class MethodNotAllowed extends Schema.TaggedError<MethodNotAllowed>()(
  "MethodNotAllowed",
  { message: Schema.String },
).pipe(Category.withBadRequestError) {}

/** 412 — the request's `If-Match` no longer matches the config's `Etag`. */
export class PreconditionFailed extends Schema.TaggedError<PreconditionFailed>()(
  "PreconditionFailed",
  { message: Schema.String },
).pipe(Category.withConflictError) {}

/**
 * `POST /load` answered 200 but the config was refused. caddyconfig/load.go
 * `handleLoad` writes the adapter's warnings to the body BEFORE calling
 * `caddy.Load`; when that then fails, Go's first `Write` already committed
 * status 200, so the later `WriteHeader(400)` is a no-op and the error JSON
 * lands appended after the warnings in the SAME body — two concatenated JSON
 * values, not one. See protocol.ts for where this is detected (a raw-text
 * check on every `LoadConfig` response, never a resource-level status check)
 * and `docs/load-200-error.md` for the measurement this mirrors.
 */
export class LoadRefused extends Schema.TaggedError<LoadRefused>()(
  "LoadRefused",
  {
    /** Caddy's `error` message — from the appended `{"error": …}` tail. */
    message: Schema.String,
    /** Adapter warnings written before the failure (often the real cause). */
    warnings: Schema.Array(Schema.String),
  },
).pipe(Category.withBadRequestError) {}

/**
 * Unknown Caddy error — a failed response whose status has no mapped error
 * class. Carries the raw body for later cataloging.
 */
export class UnknownCaddyError extends Schema.TaggedError<UnknownCaddyError>()(
  "UnknownCaddyError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class CaddyParseError extends Schema.TaggedError<CaddyParseError>()(
  "CaddyParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * Errors any Caddy operation may surface in addition to the shared HTTP
 * status errors — see `CaddyOpError` in protocol.ts for the full per-call
 * union (core's `API_ERRORS` plus these).
 */
export type ClientErrors =
  | MethodNotAllowed
  | PreconditionFailed
  | LoadRefused
  | UnknownCaddyError
  | CaddyParseError;

/**
 * Default Caddy operation errors: the shared HTTP status errors from core
 * plus the client-level fallback/decode errors.
 */
export type DefaultErrors = CoreDefaultErrors | ClientErrors;
