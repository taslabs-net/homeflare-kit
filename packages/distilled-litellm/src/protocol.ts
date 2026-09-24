/**
 * LitellmProtocol — the shared bearer-REST protocol instantiated for
 * LiteLLM Proxy.
 *
 * LiteLLM speaks plain JSON with no consistent success envelope — some
 * responses are the resource itself, others wrap a list in a named field
 * (`{"keys": [...]}`, `{"endpoints": [...]}`) per-resource, decoded by each
 * operation's own generated schema, not by this protocol.
 *
 * Authentication: `Authorization: Bearer <key>` — LiteLLM's own `litellm`
 * CLI client uses it (`litellm/proxy/client/cli/main.py` at tag v1.100.0),
 * and every `/key`, `/team`, `/user`, `/budget`, `/model` and `/config`
 * route's `Depends(user_api_key_auth)` accepts it. ⚠️ VERIFIED AGAINST THE
 * SPEC, AND FOUND WRONG: the vendor's own OpenAPI document (`litellm-openapi`
 * @ 1.100.0) declares exactly one `securitySchemes` entry —
 * `APIKeyHeader` (`type: apiKey`, `in: header`, `name: x-litellm-api-key`,
 * `description: "Bearer token"`) — not a `Bearer`/`http`-scheme security
 * requirement, and no operation references it (`security` is `null` at the
 * document root and on every operation). FastAPI's OpenAPI generator only
 * introspects a route's declared `Security()`/`Depends()` dependency for
 * the scheme it documents; `user_api_key_auth` accepts an `Authorization:
 * Bearer <key>` header by reading it directly out of the request in Python
 * (not through a `Security(APIKeyHeader(...))` FastAPI can introspect), so
 * the spec's own securityScheme names a header LiteLLM's docs, CLI and this
 * package do not actually send. `Bearer` is used here because it is what
 * the vendor's own client sends and what homeflare's existing
 * `packages/alchemy/src/litellm/client.ts` already verified works — the
 * spec is necessary input, not sufficient, exactly the case the Typed Error
 * Doctrine exists for.
 *
 * Failure envelope: heterogeneous, measured against the pinned v1.100.0
 * source (`litellm/proxy/proxy_server.py`'s `ProxyException` handler at the
 * tag, and every `management_endpoints/*.py` file) — see `errorEnvelope`
 * below and `errors.ts`'s header for the two shapes and why.
 *
 * Pagination: ad hoc per resource (`page`/`size` on some list routes,
 * `offset`/`limit` on others), no shared cursor/token — see
 * `scripts/generate.ts`.
 */
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as API from "@distilled.cloud/core/api";
import type { ConfigError } from "@distilled.cloud/core/errors";
import {
  makeRestProtocol,
  type RestErrorEnvelope,
} from "@distilled.cloud/core/protocol-rest";
import { Credentials, type Config } from "./credentials.ts";
import { UnknownLitellmError, type DefaultErrors } from "./errors.ts";

/**
 * Error channel shared by every generated LiteLLM operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * LitellmOpError, LitellmOpContext>` explicitly so the compiler never
 * infers these back out of the schema generics.
 */
export type LitellmOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated LiteLLM operation. */
export type LitellmOpContext = Credentials | HttpClient.HttpClient;

/**
 * Extract `{ message, code }` from a failed response body. Two real shapes,
 * both observed in the pinned source (see this file's header):
 *
 * 1. A genuine `ProxyException` (`proxy_server.py`'s
 *    `openai_exception_handler`): `{"error": {"message", "type", "param",
 *    "code"}}` — no `detail` wrapper at all.
 * 2. Plain FastAPI `HTTPException(status_code, detail=...)` — the vast
 *    majority of raises across `key_management_endpoints.py`,
 *    `team_endpoints.py`, `internal_user_endpoints.py`,
 *    `budget_management_endpoints.py`, `model_management_endpoints.py`,
 *    `pass_through_endpoints.py` and `litellm_pre_call_utils.py` — where
 *    `detail` is EITHER a plain string (`detail=f"..."`) →
 *    `{"detail": "<string>"}`, OR a dict shaped one of two ways:
 *    `{"error": "<full sentence>"}` (the common `budget_management_endpoints.py`
 *    shape — the whole message IS the `error` field), or an OpenAI-triple
 *    `{"error": "<short code>", "message": "<full sentence>", "param": ...}`
 *    (`litellm_pre_call_utils.py`'s `reject_url_valued_destination`, hit on
 *    EVERY proxied LLM call via `add_litellm_data_to_request` — not a corner
 *    case). ⚠️ MEASURED: when both `message` and `error` are present on the
 *    SAME object, `error` is a short code (`"invalid_request"`) and
 *    `message` is the human-readable text — `message` must win, or a real,
 *    actionable error collapses to a code word. There is no consistent
 *    machine-readable `code` on this path — `code` is only ever a
 *    `ProxyException`'s stringified HTTP status, so it is not threaded
 *    through here.
 */
const messageFrom = (v: unknown): string | undefined => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return undefined;
  }
  const o = v as Record<string, unknown>;
  // A sibling `message` always wins over a short `error` code — see this
  // function's header (the `reject_url_valued_destination` shape).
  if (typeof o.message === "string") return o.message;
  if (typeof o.error === "string") return o.error;
  if (
    o.error !== null &&
    typeof o.error === "object" &&
    !Array.isArray(o.error)
  ) {
    const inner = o.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
  }
  return undefined;
};

const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;

  // Shape 1: a bare ProxyException envelope, or a top-level string `error`
  // (defensive — not observed, but cheap to accept).
  if (typeof b.error === "string") return { message: b.error };
  const proxyExceptionMessage = messageFrom(b);
  if (proxyExceptionMessage !== undefined)
    return { message: proxyExceptionMessage };

  // Shape 2: FastAPI's `{"detail": ...}`.
  if (typeof b.detail === "string") return { message: b.detail };
  const detailMessage = messageFrom(b.detail);
  if (detailMessage !== undefined) return { message: detailMessage };

  return undefined;
};

export const LitellmProtocol: Layer.Layer<API.Protocol> =
  makeRestProtocol<Config>({
    // Resolved on the CALLING fiber per request (the layer is memoized per
    // process); the Credentials service holds an effect, so a key rotated
    // between calls is picked up without rebuilding the layer.
    credentials: Effect.gen(function* () {
      const resolve = yield* Credentials;
      return yield* resolve;
    }),
    baseUrl: (creds) => creds.apiBaseUrl,
    headers: (creds) => ({
      Authorization: `Bearer ${Redacted.value(creds.apiKey)}`,
      Accept: "application/json",
    }),
    errorEnvelope,
    unknownError: ({ code, message, body }) =>
      new UnknownLitellmError({
        code:
          typeof code === "string"
            ? code
            : code !== undefined
              ? String(code)
              : undefined,
        message,
        body,
      }),
  });
