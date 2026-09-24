/**
 * OpenBaoProtocol — the shared bearer-REST protocol instantiated for
 * OpenBao.
 *
 * OpenBao wraps every "logical" response (the vast majority — reads,
 * mount/auth/role CRUD) in an envelope: `{ request_id, lease_id,
 * renewable, lease_duration, data: {...}, wrap_info, warnings, auth }`.
 * The generated response schemas describe the INNER `data` shape only — the
 * OpenAPI document OpenBao's own generator produces documents just that
 * (measured against `.generated-specs/policies.json`'s
 * `PoliciesReadAclPolicyResponse`, which has no `request_id`/`lease_id`/etc
 * member at all) — so `transformResponse` below unwraps `data` before
 * decoding, exactly the rule the kit's hand-rolled client already applies
 * (`packages/alchemy/src/openbao/bao-http.ts`'s `baoRead`: take `data` when
 * it is an object, the whole body otherwise). A handful of endpoints are
 * NOT logical responses and have no `data` envelope at all — `sys/health`,
 * `sys/seal-status`, `sys/leader` answer their fields at the top level — so
 * the unwrap only fires when `data` is actually present and an object,
 * which leaves those untouched.
 *
 * ⚠️ NOT YET HANDLED: auth/login responses (`auth/<mount>/login`, and every
 * `*-login` operation) wrap their payload under `auth`, not `data` — this
 * protocol does not unwrap that shape yet. No migrated family calls a login
 * endpoint through this SDK today; add an `auth`-aware unwrap (or a
 * dedicated response trait) before one does.
 *
 * Failures carry `{"errors": [...]}` — zero or more strings, and often
 * literally empty (measured 2026-09-24: OpenBao 2.6.2 answers a missing ACL
 * policy read with `404 {"errors":[]}`, no text). There is normally no
 * machine-readable code, so typed errors beyond the status-derived ones
 * match on status, or on message when OpenBao actually supplies one — see
 * `patches/`.
 *
 * Authentication is `X-Vault-Token` when a credential carries a nonempty
 * token; omit it for a local agent that supplies its own identity. An
 * optional `X-Vault-Namespace` selects a namespace; absent means root.
 * `X-Vault-Request: true` admits agent listeners with require_request_header
 * (OpenBao v2.6.2 command/agent.go:544-548). A namespace does not change a mounted
 * backend's own path shape (see `stacks/distilled-submodules/spec-repos/
 * openbao/fetch-specs.ts`'s module docs for how that was confirmed), so it
 * is purely a request header here, never a path segment.
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
import { UnknownOpenBaoError, type DefaultErrors } from "./errors.ts";

/**
 * Error channel shared by every generated OpenBao operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * OpenBaoOpError, OpenBaoOpContext>` explicitly so the compiler never infers
 * these back out of the schema generics.
 */
export type OpenBaoOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated OpenBao operation. */
export type OpenBaoOpContext = Credentials | HttpClient.HttpClient;

/**
 * OpenBao error bodies are `{"errors": [...]}`. Several strings are joined
 * (`"; "`) rather than only the first kept, so a matcher's `includes` still
 * sees text further down the list; an empty array (the common 404 shape)
 * yields no `message`, and the protocol's own `HTTP <status>` fallback
 * covers it. A response that arrives without that envelope (a proxy 502, an
 * HTML error page) falls through to the same fallback.
 */
const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.errors)) return undefined;
  const messages = b.errors.filter((e): e is string => typeof e === "string");
  return { message: messages.length > 0 ? messages.join("; ") : undefined };
};

/** Unwrap the `data` envelope — see this file's module docs. */
const transformResponse = (body: unknown): unknown => {
  if (body === null || typeof body !== "object") return body;
  const data = (body as Record<string, unknown>).data;
  return typeof data === "object" && data !== null ? data : body;
};

export const OpenBaoProtocol: Layer.Layer<API.Protocol> =
  makeRestProtocol<Config>({
    // Resolved on the CALLING fiber per request (the layer is memoized per
    // process); the Credentials service holds an effect, so a token rotated
    // between calls is picked up without rebuilding the layer.
    credentials: Effect.gen(function* () {
      const resolve = yield* Credentials;
      return yield* resolve;
    }),
    baseUrl: (creds) => creds.apiBaseUrl,
    headers: (creds) => ({
      ...(creds.token && Redacted.value(creds.token) !== ""
        ? { "X-Vault-Token": Redacted.value(creds.token) }
        : {}),
      "X-Vault-Request": "true",
      ...(creds.namespace ? { "X-Vault-Namespace": creds.namespace } : {}),
      Accept: "application/json",
    }),
    errorEnvelope,
    transformResponse,
    unknownError: ({ code, message, body }) =>
      new UnknownOpenBaoError({
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
