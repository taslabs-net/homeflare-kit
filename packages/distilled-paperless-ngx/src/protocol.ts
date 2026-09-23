/**
 * PaperlessNgxProtocol — the shared bearer-REST protocol instantiated for
 * Paperless-ngx.
 *
 * Paperless-ngx speaks plain JSON with no response envelope: a detail
 * endpoint returns the object itself, a list endpoint returns
 * `{ count, next, previous, results: [...] }` as an ordinary output shape
 * (not a raw-response wrapper — `next`/`previous` are full URLs, which the
 * shared v0 pagination HEURISTIC does not match, exactly NetBox's case; see
 * scripts/convert.ts), and many mutations answer `204 No Content`. Every
 * page-number list operation still paginates: a `/shapes` patch in the
 * tag's own `patches/<tag>/_undeclared-errors.json` stamps
 * `smithy.api#paginated` by hand (the same technique
 * packages/cloudflare/patches/dns/listRecords.json uses), and
 * src/pagination.ts documents why core's `paginatePageNumber` strategy
 * still terminates correctly even though `next` is a URL, not a number.
 *
 * Authentication is DRF's `TokenAuthentication` — `Authorization: Token
 * <token>` — NOT `Bearer`. Confirmed against the pinned v3.1.1 document's own
 * `components.securitySchemes.tokenAuth` (`"Token-based authentication with
 * required prefix \"Token\""`), and already load-bearing in homeflare-kit's
 * hand-written client (packages/alchemy/src/paperless/client.ts).
 *
 * ⚠️ `Accept: application/json; version=10` ON EVERY CALL. Paperless-ngx
 * versions its API with DRF's `AcceptHeaderVersioning`
 * (`REST_FRAMEWORK.DEFAULT_VERSION = '10'`, `ALLOWED_VERSIONS = ['9','10']`
 * per codegen/manifest.json's `paperless-openapi` note). Omitting the header
 * still answers — DRF falls back to `DEFAULT_VERSION` — but pinning it here,
 * exactly as the kit's own client does, means an estate upgrade that moves
 * the default cannot silently change what this SDK receives without a
 * version bump of its own noticing.
 *
 * Failure bodies have no single shape (see errors.ts): `{ detail }` for
 * 403/404, a field→[messages] (or `non_field_errors`) object for 400
 * validation failures, and — when the front door is up but Paperless-ngx
 * itself is not — an HTML page from the reverse proxy that is not JSON at
 * all. `errorEnvelope` reduces the first two to a readable `message`; the
 * third never reaches it (`makeRestProtocol` skips the envelope for a
 * non-JSON body and uses the raw text as the message/body instead), so a
 * 502 lands on `BadGateway` with the proxy's HTML as its `body`, never
 * silently as "not found". Same three shapes, same reasoning, as NetBox's
 * identical DRF stack (src/protocol.ts there).
 *
 * ⚠️ THE 302 TRAP: a wrong `apiBaseUrl` (pointed at the web UI's origin, an
 * old path, or a reverse proxy that redirects unauthenticated/unknown
 * routes to a login page) does NOT fail cleanly. Measured live 2026-09-23:
 * `GET /api/no-such-endpoint/` → `302`, a redirect to the web UI, not JSON.
 * `makeRestProtocol`'s shared `decode` (packages/core/src/protocol-rest.ts)
 * only branches on `status >= 400`; every 3xx falls into the SAME path as a
 * real 2xx success and is handed to the operation's output schema decoder.
 * Depending on whether the underlying `HttpClient` follows the redirect,
 * that means either the HTML page's text fails to decode against the
 * expected JSON shape, or an empty/short redirect body decodes as `{}` and
 * fails the same way — a confusing schema-decode error, not a clear
 * "wrong URL" or network error. There is no cheap fix: `RestProtocolOptions`
 * has no hook for inspecting `response.status` before the `>= 400` branch,
 * `transformResponse` only runs on the already-2xx-shaped body, and adding
 * a status-range check would mean changing distilled core itself, which is
 * out of bounds for a package-level patch (core's quirks-go-in-protocol.ts
 * rule cuts the other way here — the package has no hook to use). So this
 * is DOCUMENTED, not handled: if a call fails with a schema-decode error
 * instead of a typed Paperless-ngx error, check `apiBaseUrl` first.
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
import { UnknownPaperlessNgxError, type DefaultErrors } from "./errors.ts";

/** Pinned per the module doc above — see codegen/manifest.json's note on `DEFAULT_VERSION`. */
const API_VERSION = "10";

/**
 * Error channel shared by every generated Paperless-ngx operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * PaperlessNgxOpError, PaperlessNgxOpContext>` explicitly so the compiler
 * never infers these back out of the schema generics.
 */
export type PaperlessNgxOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated Paperless-ngx operation. */
export type PaperlessNgxOpContext = Credentials | HttpClient.HttpClient;

/**
 * `{ detail: "..." }` (403/404 and most non-validation failures) reduces
 * directly. A 400 validation failure has no `detail` — DRF serializes it as
 * the bare field-error object, e.g. `{ name: ["This field is required."],
 * non_field_errors: ["..."] }` — so every array-of-strings member is joined
 * into `"field: msg1, msg2"` and the parts joined with `"; "`. A body with
 * neither shape (rare — a non-DRF failure ahead of Paperless-ngx) falls
 * through to the protocol's raw-text / `HTTP <status>` default.
 */
const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === "string") return { message: b.detail };

  const parts: string[] = [];
  for (const [field, value] of Object.entries(b)) {
    if (Array.isArray(value)) {
      const messages = value.filter((v): v is string => typeof v === "string");
      if (messages.length > 0) parts.push(`${field}: ${messages.join(", ")}`);
    } else if (typeof value === "string") {
      parts.push(`${field}: ${value}`);
    }
  }
  return parts.length > 0 ? { message: parts.join("; ") } : undefined;
};

export const PaperlessNgxProtocol: Layer.Layer<API.Protocol> =
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
      Accept: `application/json; version=${API_VERSION}`,
      Authorization: `Token ${Redacted.value(creds.token)}`,
    }),
    errorEnvelope,
    unknownError: ({ code, message, body }) =>
      new UnknownPaperlessNgxError({
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
