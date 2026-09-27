/**
 * UnifiNetworkProtocol — the shared header-auth REST protocol instantiated
 * for the UniFi Network Integration API.
 *
 * The spec's `info.description` is empty and its `components` carries no
 * `securitySchemes` — this package cannot generate its auth from the
 * document, unlike almost every other OpenAPI-sourced package here. The
 * `X-API-KEY` header is sourced from Ubiquiti's own Integration API guide;
 * see the warning in `src/credentials.ts`.
 *
 * Response envelope: list endpoints return `{ count, data, limit, offset,
 * totalCount }` (offset pagination — see `scripts/convert.ts` for why no
 * `smithy.api#paginated` trait is stamped yet); single-resource endpoints
 * return the object directly; mutations return the created/updated object
 * (`200`/`201`), never `204`.
 *
 * FAILURE ENVELOPE (T8): no OPERATION documents an error response, but the
 * pinned spec's own `components.schemas["Error Message"]` — `{code,
 * message, requestId, requestPath, statusCode, statusName, timestamp}`,
 * referenced by zero operations — is the vendor's real failure shape.
 * `errorEnvelope` below decodes `code`/`message` from it, which the shared
 * REST protocol folds into every status-mapped error's `message` (so a
 * `NotFound`, say, carries the vendor's own text instead of a bare `HTTP
 * 404`); `unknownError` additionally reads `requestId`/`statusCode`/
 * `statusName`/`timestamp` straight off the parsed body for the fallback
 * `UnknownUnifiNetworkError`. `requestPath` is READ NOWHERE below — it is
 * deliberately excluded from both the envelope and the error's fields (T3;
 * see `src/errors.ts`'s doc comment) — never let it reach a `message`. This
 * is derived from the spec, not yet confirmed against a real captured
 * failure (no live call has been made for this work); the shape may need a
 * correction once one is.
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
import { UnknownUnifiNetworkError, type DefaultErrors } from "./errors.ts";

/**
 * Error channel shared by every generated UniFi Network operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * UnifiNetworkOpError, UnifiNetworkOpContext>` explicitly so the compiler
 * never infers these back out of the schema generics.
 */
export type UnifiNetworkOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated UniFi Network operation. */
export type UnifiNetworkOpContext = Credentials | HttpClient.HttpClient;

/**
 * Decode the spec's `Error Message` schema (see module docs, T8): `code` is
 * a dotted string (e.g. `"api.authentication.missing-credentials"`, never
 * numeric in this spec — {@link RestErrorEnvelope}'s `code` allows both
 * because other providers' envelopes use numeric codes), `message` a plain
 * string. Anything else — a non-JSON body, or JSON that isn't this shape —
 * returns `undefined` and the shared protocol falls back to its own
 * `HTTP <status>` default. `requestPath` is READ HERE ON PURPOSE ONLY TO
 * SKIP IT: it is never assigned to `code`/`message`, so it can never reach
 * the `message` string every status-mapped error surfaces (T3).
 */
const errorEnvelope = (body: unknown): RestErrorEnvelope | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const code = typeof b.code === "string" ? b.code : undefined;
  const message = typeof b.message === "string" ? b.message : undefined;
  if (code === undefined && message === undefined) return undefined;
  return { code, message };
};

/**
 * The rest of the `Error Message` envelope beyond `code`/`message` —
 * {@link RestErrorEnvelope} has no room for it, so `unknownError` below
 * reads it straight off the parsed body it already receives. Never reads
 * `requestPath` (T3).
 */
const restEnvelopeFields = (
  body: unknown,
): {
  readonly requestId: string | undefined;
  readonly statusCode: number | undefined;
  readonly statusName: string | undefined;
  readonly timestamp: string | undefined;
} => {
  const b =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : undefined;
  return {
    requestId: typeof b?.requestId === "string" ? b.requestId : undefined,
    statusCode: typeof b?.statusCode === "number" ? b.statusCode : undefined,
    statusName: typeof b?.statusName === "string" ? b.statusName : undefined,
    timestamp: typeof b?.timestamp === "string" ? b.timestamp : undefined,
  };
};

export const UnifiNetworkProtocol: Layer.Layer<API.Protocol> =
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
      "X-API-KEY": Redacted.value(creds.apiKey),
      Accept: "application/json",
    }),
    errorEnvelope,
    unknownError: ({ code, message, body }) =>
      new UnknownUnifiNetworkError({
        code:
          typeof code === "string"
            ? code
            : code !== undefined
              ? String(code)
              : undefined,
        message,
        ...restEnvelopeFields(body),
        body,
      }),
  });
