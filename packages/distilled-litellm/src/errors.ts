/**
 * LiteLLM-specific error types.
 *
 * Re-exports the common HTTP errors from core and adds the LiteLLM-specific
 * unknown-error and parse-error wrappers.
 *
 * LiteLLM Proxy's failure envelope is genuinely heterogeneous — measured
 * against the pinned `v1.100.0` source, NOT assumed from the spec (whose own
 * `ErrorResponse` schema names only one of the real shapes). A `ProxyException`
 * (`proxy_server.py`'s `openai_exception_handler` at the tag, the path a
 * `router.py` "no healthy deployment" style failure funnels through) answers
 * a BARE `{"error": {"message", "type", "param", "code"}}` — no `detail`
 * wrapper at all. Plain FastAPI `HTTPException(status_code, detail=...)` —
 * the dominant pattern across every `/key`, `/team`, `/user`, `/budget`,
 * `/model` and `/config` route in `management_endpoints/*.py` — answers
 * `{"detail": "<string>"}` OR `{"detail": {"error": ..., "message"?: ...}}`,
 * NOT the `{"detail": [...]}` array `RequestValidationError` uses for 422
 * (see `HTTPValidationError`/`ValidationError` in the vendor spec, decoded
 * by core's shared `UnprocessableEntity`). See `protocol.ts`'s
 * `errorEnvelope`/`messageFrom` for the exact extraction order — a sibling
 * `message` field always wins over a short `error` code, verified against
 * `litellm_pre_call_utils.py`'s `reject_url_valued_destination`. There is no
 * machine-readable code on most routes (LiteLLM's own `code` field is
 * usually the stringified status, e.g. `"400"`), so the SDK dispatches on
 * the HTTP status: the per-operation classes generated from each
 * operation's declared responses first, then core's shared status map, then
 * {@link UnknownLitellmError}.
 *
 * ⛔ The vendor's own OpenAPI document (`litellm-openapi` @ 1.100.0, dumped
 * by the vendor's own `gen-api-types.mjs` — see `scripts/convert.ts`)
 * declares almost NO error responses beyond the FastAPI-automatic `422` —
 * measured across all 696 paths, the only per-operation `400`/`401`/`403`/
 * `404`/`408`/`429`/`500`/`503` declarations anywhere outside the
 * `/openai/deployments/{model}/chat/completions` LLM-passthrough route are
 * `GET /audit/{id}`'s `404`/`500` (both already in the spec — no patch
 * needed). None of the admin surface this package's tag split covers
 * (`model_management`, `key_management`, `team_management`,
 * `internal_user_management`, `budget_management`, the untagged
 * `/config/pass_through_endpoint*` family) declares anything beyond `422`.
 * `401`/`429`/`500`/`502`/`503`/`504` still typecheck on every operation —
 * they ride the shared `LitellmOpError` union via core's
 * `DEFAULT_ERROR_STATUSES` (see `protocol.ts`) — but a status OUTSIDE that
 * default set (`400`, `403`, `404`, `409`, `423`) that the spec doesn't
 * declare for a given operation would decode correctly at runtime (core's
 * shared `HTTP_STATUS_MAP` fallback in `protocol-rest.ts` still maps it) but
 * NOT appear in that operation's TypeScript error union — an untyped escape
 * the Typed Error Doctrine exists to catch. `patches/misc/…json` fixes the
 * one such case this package has vendor-source evidence for (see its own
 * comment); the rest of the admin surface is unverified beyond the spec —
 * see this package's README.
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
 * Unknown LiteLLM error — returned when a failed response's HTTP status has
 * no mapped error class, or the body doesn't match the `ProxyException`
 * envelope. Carries the raw body for later cataloging.
 */
export class UnknownLitellmError extends Schema.TaggedError<UnknownLitellmError>()(
  "UnknownLitellmError",
  {
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    body: Schema.Unknown,
  },
).pipe(Category.withServerError) {}

/** Schema parse error wrapper. */
export class LitellmParseError extends Schema.TaggedError<LitellmParseError>()(
  "LitellmParseError",
  {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  },
).pipe(Category.withParseError) {}

/**
 * Errors any LiteLLM operation may surface in addition to the per-operation
 * typed status errors.
 */
export type ClientErrors = UnknownLitellmError | LitellmParseError;

/**
 * Default LiteLLM operation errors: the shared HTTP status errors from core
 * plus the client-level fallback/decode errors.
 */
export type DefaultErrors = CoreDefaultErrors | ClientErrors;
