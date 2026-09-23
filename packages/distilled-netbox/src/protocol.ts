/**
 * NetboxProtocol — the shared bearer-REST protocol instantiated for NetBox.
 *
 * NetBox speaks plain JSON with no response envelope: a detail endpoint
 * returns the object itself, a list endpoint returns
 * `{ count, next, previous, results: [...] }` as an ordinary output shape
 * (not a raw-response wrapper). `next`/`previous` are full URLs, not a bare
 * token core's generic pagination strategies can follow directly — every
 * list operation carries `smithy.api#paginated`
 * (patches/<tag>/_pagination.json) and streams through the hand-written
 * `netboxPaginate` strategy in ./pagination.ts, which parses `next`'s query
 * string instead of forwarding it as a token; see that file for the full
 * reasoning. A handful of custom sub-resource GETs
 * (`available-ips`, `available-vlans`, …) return a bare JSON array, and
 * many mutations answer `204 No Content`.
 *
 * Authentication is DRF's `TokenAuthentication` — `Authorization: Token
 * <token>` — NOT `Bearer`. Measured against this estate's own instance
 * (homeflare-kit's netbox/client.ts, v4.7.0): `Bearer` answers 401, `Token`
 * answers 200, and the two failures are otherwise indistinguishable.
 *
 * Failure bodies have no single shape (see errors.ts): `{ detail }` for
 * 403/404, a field→[messages] (or `non_field_errors`) object for 400
 * validation failures, and — when the front door is up but NetBox itself
 * is not — an HTML page from the reverse proxy that is not JSON at all.
 * `errorEnvelope` reduces the first two to a readable `message`; the third
 * never reaches it (`makeRestProtocol` skips the envelope for a non-JSON
 * body and uses the raw text as the message/body instead), so a 502 lands
 * on `BadGateway` with the proxy's HTML as its `body`, never silently as
 * "not found".
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
import { UnknownNetboxError, type DefaultErrors } from "./errors.ts";

/**
 * Error channel shared by every generated NetBox operation. Generated
 * service files annotate operations with `API.OperationMethod<I, O,
 * NetboxOpError, NetboxOpContext>` explicitly so the compiler never infers
 * these back out of the schema generics.
 */
export type NetboxOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated NetBox operation. */
export type NetboxOpContext = Credentials | HttpClient.HttpClient;

/**
 * `{ detail: "..." }` (403/404 and most non-validation failures) reduces
 * directly. A 400 validation failure has no `detail` — DRF serializes it as
 * the bare field-error object, e.g. `{ vid: ["This field is required."],
 * non_field_errors: ["..."] }` — so every array-of-strings member is joined
 * into `"field: msg1, msg2"` and the parts joined with `"; "`. A body with
 * neither shape (rare — a non-DRF failure ahead of NetBox) falls through to
 * the protocol's raw-text / `HTTP <status>` default.
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

export const NetboxProtocol: Layer.Layer<API.Protocol> =
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
      Authorization: `Token ${Redacted.value(creds.token)}`,
      Accept: "application/json",
    }),
    errorEnvelope,
    unknownError: ({ code, message, body }) =>
      new UnknownNetboxError({
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
