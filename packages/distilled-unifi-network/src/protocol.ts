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
 * FAILURE ENVELOPE IS UNKNOWN: no operation in the spec documents an error
 * response, so there is no field to read a machine-readable code or message
 * from (`errorEnvelope` below always returns undefined, meaning every
 * failure falls through to the protocol's raw-text / `HTTP <status>`
 * default and `unknownError`). Replace this the first time a real console
 * failure is captured and its body shape is known.
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
 * No documented failure envelope to parse (see module docs) — every failure
 * falls through to the protocol's status-derived default and
 * {@link UnknownUnifiNetworkError}.
 */
const errorEnvelope = (_body: unknown): RestErrorEnvelope | undefined =>
  undefined;

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
        body,
      }),
  });
