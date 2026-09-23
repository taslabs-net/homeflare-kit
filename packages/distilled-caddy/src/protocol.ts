/**
 * CaddyProtocol — hand-written, NOT `core/protocol-rest`'s `makeRestProtocol`.
 *
 * Every other REST provider in this repo (Docker, Forgejo, …) is one
 * `makeRestProtocol(...)` call because its decode cascade is uniform: 2xx is
 * always the payload, non-2xx is always the failure. Caddy's `POST /load`
 * breaks that assumption — a REFUSED load can still answer 200 (see
 * `load-response.ts`) — and `makeRestProtocol`'s `decode` has no seam to
 * intercept a single operation's response before the generic cascade runs.
 * So this file reimplements that cascade by hand, using the SAME primitives
 * `protocol-rest.ts` does (`buildRequest`, `mapKeys`, `wrapSensitive`,
 * `HTTP_STATUS_MAP`), with one extra branch gated on `config.operationName`.
 *
 * request:  no credentials beyond where the admin API is (it has none — see
 *           credentials.ts); `Host`/`Origin` headers set from `hostHeader`
 *           so Caddy's DNS-rebinding check passes over TCP.
 * response: `LoadConfig` gets the embedded-error scan; `CaCertificates`
 *           returns PEM text, never JSON, so it skips parsing entirely;
 *           everything else is 2xx-is-payload / non-2xx-is-`{"error":…}`,
 *           the same shape core's default REST envelope already reads.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as AST from "effect/SchemaAST";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as API from "@distilled.cloud/core/api";
import { buildRequest, mapKeys } from "@distilled.cloud/core/protocol-http";
import {
  unwrapRedactedDeep,
  wrapSensitive,
} from "@distilled.cloud/core/protocol-rest";
import {
  HTTP_STATUS_MAP,
  InternalServerError,
  type ConfigError,
} from "@distilled.cloud/core/errors";
import { parseRetryAfterForStatus } from "@distilled.cloud/core/retry-after";
import { Credentials, type Config } from "./credentials.ts";
import {
  type API_ERRORS,
  LoadRefused,
  MethodNotAllowed,
  PreconditionFailed,
  UnknownCaddyError,
  type DefaultErrors,
} from "./errors.ts";
import {
  describedWarningsInLoadBody,
  errorInLoadBody,
  warningsInLoadBody,
} from "./load-response.ts";

/** Error channel shared by every generated Caddy operation (broad, like Docker's — every admin route can plausibly 4xx/5xx; see errors.ts for why 405/412 are added). */
export type CaddyOpError =
  | DefaultErrors
  | InstanceType<(typeof API_ERRORS)[number]>
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated Caddy operation. */
export type CaddyOpContext = Credentials | HttpClient.HttpClient;

/** `HTTP_STATUS_MAP` plus the two statuses Caddy uses that core's default doesn't cover. */
const STATUS_MAP: Readonly<Record<number, new (args: any) => any>> = {
  ...HTTP_STATUS_MAP,
  405: MethodNotAllowed,
  412: PreconditionFailed,
};

/** Caddy's `{"error": "…"}` envelope — the same key core's lenient default reads, spelled out because this protocol does not use that default. */
const errorMessage = (body: unknown): string | undefined => {
  if (body === null || typeof body !== "object") return undefined;
  const message = (body as Record<string, unknown>).error;
  return typeof message === "string" ? message : undefined;
};

const fail = (e: unknown): Effect.Effect<never> =>
  Effect.fail(e) as Effect.Effect<never>;

const encode = ({
  input,
  inputAst,
}: {
  readonly input: unknown;
  readonly inputAst: AST.AST;
}) =>
  Effect.gen(function* () {
    // Two yields, not one: `Credentials`'s service type IS an effect
    // (`Context.Service<Credentials, Effect.Effect<Config>>` — see
    // credentials.ts), resolved on the calling fiber per request rather than
    // once at layer-build time, so a caller who swaps `Credentials` mid-run
    // (e.g. pointing at a different Caddy) is picked up on the next call.
    const resolve = yield* Credentials;
    const { apiBaseUrl, hostHeader }: Config = yield* resolve;
    const host = hostHeader ?? new URL(apiBaseUrl).host;
    // `buildRequest` reads the operation's `Http()` trait off `inputAst`
    // itself (method + URI template) — nothing route-specific to add here,
    // since Caddy's admin API is a single endpoint.
    return buildRequest({
      input: unwrapRedactedDeep(input),
      inputAst,
      baseUrl: apiBaseUrl,
      // Caddy checks `Host` against its OWN listen address (admin.go
      // `checkHost`) and, over TCP, requires a matching `Origin` too
      // (`checkOrigin`) — both set here exactly as the Caddy CLI sends them
      // (cmd/commandfuncs.go `AdminAPIRequest`). A unix-socket transport
      // (the caller's HttpClient layer) may override or drop these; Caddy
      // skips the Host check entirely on unix listeners.
      headers: { Host: host, Origin: `http://${host}` },
    });
  });

const decode = ({
  response,
  outputAst,
  config,
}: {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly outputAst: AST.AST;
  readonly config: API.ProtocolOperationConfig;
}) =>
  Effect.gen(function* () {
    const text = (yield* response.text.pipe(Effect.orDie)) ?? "";
    const status = response.status;
    const headers = response.headers as Record<string, string | undefined>;

    // `POST /load` alone: a refused config can still answer 200 (see
    // load-response.ts) — checked before anything else, on every status,
    // because the failing case IS a 200.
    if (config.operationName === "LoadConfig") {
      const message = errorInLoadBody(text);
      if (message !== undefined) {
        return yield* fail(
          new LoadRefused({
            message,
            warnings: describedWarningsInLoadBody(text),
          }),
        );
      }
      if (status >= 400)
        return yield* fail(classifyStatus(status, text, headers));
      return { warnings: warningsInLoadBody(text) };
    }

    // `GET /pki/ca/<id>/certificates`: PEM text, never JSON, and never hits
    // the 200-with-error shape `/load` has — a plain status check suffices.
    if (config.operationName === "CaCertificates") {
      if (status >= 400)
        return yield* fail(classifyStatus(status, text, headers));
      return { pem: text };
    }

    // `GET /config/{path}` and `GET /id/{id}/{path}`: the body IS the bare
    // config value (`document` — no envelope), plus an `Etag` response
    // header (admin.go `makeEtag`) for the next call's `If-Match`. No
    // established convention here maps a bare-document body alongside a
    // header into one output structure (RawResponseRoot is for a bare
    // ARRAY/scalar with no sibling members — see GetConfigResponse in
    // scripts/shapes/config.ts), so this is constructed directly.
    if (
      config.operationName === "GetConfig" ||
      config.operationName === "GetConfigById"
    ) {
      let value: unknown = null;
      let parseFailed = false;
      try {
        value = text.trim().length > 0 ? JSON.parse(text) : null;
      } catch {
        parseFailed = true;
      }
      if (status >= 400) {
        return yield* fail(
          classifyStatus(
            status,
            parseFailed ? text.trim() : errorMessage(value),
            headers,
            parseFailed ? text : value,
          ),
        );
      }
      // Malformed body on a 2xx would be a Caddy-side bug, not a client
      // error — surface the raw text rather than mask it as `null`.
      return { value: parseFailed ? text : value, etag: headers.etag };
    }

    let json: unknown;
    let nonJson = false;
    if (text.trim().length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        nonJson = true;
      }
    }
    if (status >= 400) {
      return yield* fail(
        classifyStatus(
          status,
          nonJson ? text.trim() : errorMessage(json),
          headers,
          nonJson ? text : json,
        ),
      );
    }
    const body: unknown = nonJson ? text : (json ?? {});
    return wrapSensitive(outputAst, mapKeys(outputAst, body, "decode"));
  });

/** Status → typed error, honoring `retryAfter` hints on the statuses core's classes declare it for. */
const classifyStatus = (
  status: number,
  message: string | undefined,
  headers: Record<string, string | undefined>,
  rawBody?: unknown,
): unknown => {
  const StatusErrorClass = STATUS_MAP[status];
  const text = message ?? `HTTP ${String(status)}`;
  if (StatusErrorClass) {
    return new StatusErrorClass({
      message: text,
      retryAfter: parseRetryAfterForStatus(status, headers),
    });
  }
  if (status >= 500) {
    return new InternalServerError({
      message: text,
      retryAfter: parseRetryAfterForStatus(status, headers),
    });
  }
  return new UnknownCaddyError({ message: text, body: rawBody });
};

export const CaddyProtocol: Layer.Layer<API.Protocol> = Layer.succeed(
  API.Protocol,
  API.Protocol.of({
    encode: (args) =>
      encode(args) as Effect.Effect<HttpClientRequest.HttpClientRequest>,
    decode,
  }),
);
