/**
 * OpenBao-specific error types.
 *
 * Re-exports the common HTTP errors from core and adds the OpenBao-specific
 * unknown-error and parse-error wrappers.
 *
 * OpenBao's failure envelope is `{"errors": [...]}` — zero or more strings,
 * frequently empty (measured 2026-09-24: a 404 on a missing ACL policy
 * answers `{"errors":[]}`, no text at all — vault/logical_system.go's
 * `handlePoliciesRead` returns no response, which `RespondErrorCommon` turns
 * into a bare status). There is rarely a machine-readable code, so most
 * operations dispatch on the HTTP status alone: the per-operation classes
 * generated from each operation's declared responses first, then core's
 * shared status map, then {@link UnknownOpenBaoError}. Operations whose
 * absence, conflict or refusal needs a resource-specific tag are typed by
 * status (and message, when OpenBao supplies one) under `patches/`.
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
import type { API_ERRORS } from "@distilled.cloud/core/errors";

import * as Schema from "effect/Schema";
import * as Category from "@distilled.cloud/core/category";

/**
 * Unknown OpenBao error — returned when a failed response's HTTP status has
 * no mapped error class. Carries the raw body for later cataloging.
 */
export class UnknownOpenBaoError extends Schema.TaggedError<UnknownOpenBaoError>()(
  "UnknownOpenBaoError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class OpenBaoParseError extends Schema.TaggedError<OpenBaoParseError>()(
  "OpenBaoParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * Errors any OpenBao operation may surface in addition to the per-operation
 * typed status errors.
 */
export type ClientErrors = UnknownOpenBaoError | OpenBaoParseError;

/**
 * Default OpenBao operation errors: the shared HTTP status errors from core
 * plus the client-level fallback/decode errors.
 */
export type DefaultErrors =
  | InstanceType<(typeof API_ERRORS)[number]>
  | ClientErrors;
