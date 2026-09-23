/**
 * OPNsense-specific error types — hand-written.
 *
 * OPNsense is a 200-with-failure vendor (see `protocol.ts`'s module doc):
 * most of what a caller needs to `catchTag` on never reaches an HTTP error
 * status at all. This module's classes are read directly off
 * `src/opnsense/www/api.php` (the `/api/*` front controller — mirrored at
 * `specs/core/models/Base/` is the controller CONTRACT those bodies come
 * from; `api.php` itself is not mirrored, since it is not model/controller
 * source the converter reads, but its four `catch` clauses are exactly the
 * four non-2xx/vendor-exception shapes below):
 *
 *   catch UserException            → getHttpCode() (500 unless a subclass
 *                                     overrides it) + {errorMessage,
 *                                     errorTitle, errorLevel} — a real
 *                                     business-rule denial (Alias/Category/
 *                                     Group's "in use" checks, Filter's
 *                                     "cannot move" checks), NOT a server
 *                                     fault: never retried.
 *   catch DispatchException        → 404 {errorMessage} (route/controller/
 *                                     action not found — e.g. a plugin
 *                                     module that isn't installed).
 *   catch Error|Exception          → 500 {errorMessage: "Unexpected error,
 *                                     check log for details"} (a PHP fault).
 *   (not sent)                     → the ORIGINAL response, when none of
 *                                     the above threw — this is everything
 *                                     else: the 401/403/400 auth/CSRF/JSON
 *                                     shapes from `ApiControllerBase::before
 *                                     ExecuteRoute` ({status:<code>,
 *                                     message}, `status` a NUMBER — do not
 *                                     confuse with the unrelated string
 *                                     `status` OPNsense's OWN operations
 *                                     return, e.g. service status/
 *                                     reconfigure) and the 200
 *                                     `{result:"failed", validations?}`
 *                                     shape every `ApiMutableModelController
 *                                     Base` mutation can answer with.
 */
import * as Schema from "effect/Schema";
import * as Category from "@distilled.cloud/core/category";
import {
  ConfigError,
  Unauthorized,
  Forbidden,
  BadRequest,
  NotFound,
  InternalServerError,
} from "@distilled.cloud/core/errors";
export {
  ConfigError,
  Unauthorized,
  Forbidden,
  BadRequest,
  NotFound,
  InternalServerError,
};

/** `{"result":"failed", validations?: {...}}` from `ApiMutableModelControllerBase::validate()`/`setBase`/`addBase`/`delBase`/`toggleBase` — always HTTP 200. `validations` is absent for a non-field failure (bad uuid, wrong verb); present and keyed `<prefix>.<field>` → one message or several for a real field error. */
export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  "ValidationFailed",
  {
    validations: Schema.Record(
      Schema.String,
      Schema.Union([Schema.String, Schema.Array(Schema.String)]),
    ),
  },
).pipe(Category.withBadRequestError) {}

/** A plain `UserException` (`errorLevel: "error"`, default HTTP 500) — a business-rule denial such as "Alias in use" or "cannot move to the same spot", not a server fault: `Category.withBadRequestError`, never retried. */
export class OpnsenseUserError extends Schema.TaggedError<OpnsenseUserError>()(
  "OpnsenseUserError",
  { title: Schema.optional(Schema.String), message: Schema.String },
).pipe(Category.withBadRequestError) {}

/** A `UserWarningException` — HTTP 200, but the request did NOT do what was asked (`UserWarningException::getHttpCode()` is hard-coded 200). */
export class OpnsenseUserWarning extends Schema.TaggedError<OpnsenseUserWarning>()(
  "OpnsenseUserWarning",
  { title: Schema.optional(Schema.String), message: Schema.String },
).pipe(Category.withBadRequestError) {}

/** A `UserInformationalException` — HTTP 200, an informational abort (e.g. "nothing to do"). */
export class OpnsenseUserNotice extends Schema.TaggedError<OpnsenseUserNotice>()(
  "OpnsenseUserNotice",
  { title: Schema.optional(Schema.String), message: Schema.String },
).pipe(Category.withBadRequestError) {}

/** Unmapped failure — a response this SDK's protocol layer could not classify into any of the above (non-JSON body, a shape none of the known cases match). Carries the raw body for later cataloging. */
export class UnknownOpnsenseError extends Schema.TaggedError<UnknownOpnsenseError>()(
  "UnknownOpnsenseError",
  { status: Schema.Number, body: Schema.Unknown },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class OpnsenseParseError extends Schema.TaggedError<OpnsenseParseError>()(
  "OpnsenseParseError",
  { body: Schema.Unknown, cause: Schema.Unknown },
).pipe(Category.withParseError) {}

export type ClientErrors =
  | ValidationFailed
  | OpnsenseUserError
  | OpnsenseUserWarning
  | OpnsenseUserNotice
  | UnknownOpnsenseError
  | OpnsenseParseError;

/** Default errors every generated OPNsense operation carries — see the module doc for where each one comes from. */
export type DefaultErrors =
  | Unauthorized
  | Forbidden
  | BadRequest
  | NotFound
  | InternalServerError
  | ConfigError
  | ClientErrors;
