/**
 * OpnsenseProtocol — hand-written.
 *
 * OPNsense is a 200-with-failure vendor: `ApiMutableModelControllerBase`'s
 * `set/add/del/toggleBase` (mirrored at `specs/core/models/Base/
 * ApiMutableModelControllerBase.php`) answer HTTP 200 with
 * `{"result":"failed", "validations"?: {...}}` on a validation error, and a
 * plain `UserException`/`UserWarningException`/`UserInformationalException`
 * thrown anywhere in a controller answers `{errorMessage, errorTitle?,
 * errorLevel}` at 500/200/200 respectively (`src/opnsense/www/api.php`'s
 * `catch` chain — see `errors.ts`'s module doc for the exact mapping this
 * mirrors). `@distilled.cloud/core/protocol-rest`'s generic REST decode
 * only ever branches on `response.status >= 400`, which is wrong for every
 * one of those in-band failures — so, like `cloudflare` (the other
 * envelope-with-embedded-failure provider in this monorepo), this package
 * hand-rolls `decode` instead of calling `makeRestProtocol`. `encode` has
 * no such quirk (OPNsense's request shape is plain REST) and reuses core's
 * `buildRequest` directly.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as AST from "effect/SchemaAST";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as API from "@distilled.cloud/core/api";
import { buildRequest, mapKeys } from "@distilled.cloud/core/protocol-http";
import { ConfigError, HTTP_STATUS_MAP } from "@distilled.cloud/core/errors";
import { Credentials, type Config } from "./credentials.ts";
import {
  ValidationFailed,
  OpnsenseUserError,
  OpnsenseUserWarning,
  OpnsenseUserNotice,
  UnknownOpnsenseError,
  type DefaultErrors,
} from "./errors.ts";

/** Error channel shared by every generated OPNsense operation. */
export type OpnsenseOpError =
  | DefaultErrors
  | ConfigError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated OPNsense operation. */
export type OpnsenseOpContext = Credentials | HttpClient.HttpClient;

const fail = (e: unknown): Effect.Effect<never> =>
  Effect.fail(e) as Effect.Effect<never>;

/** `{status: 401|403|400, message}` from `ApiControllerBase::beforeExecuteRoute` — the ONE OPNsense shape with a genuine (numeric) `status` field and a non-2xx HTTP status to match it. */
const isAuthGateBody = (
  body: unknown,
): body is { status: number; message: string } =>
  typeof body === "object" &&
  body !== null &&
  typeof (body as any).status === "number" &&
  typeof (body as any).message === "string";

/** `{errorMessage, errorTitle?, errorLevel?}` from `api.php`'s `UserException`/`DispatchException`/generic-`Exception` catch chain. */
const isVendorExceptionBody = (
  body: unknown,
): body is { errorMessage: string; errorTitle?: string; errorLevel?: string } =>
  typeof body === "object" &&
  body !== null &&
  typeof (body as any).errorMessage === "string";

/** `{result:"failed", validations?}` from `ApiMutableModelControllerBase::validate/set/add/del/toggleBase`. */
const isResultFailedBody = (
  body: unknown,
): body is { result: string; validations?: unknown } =>
  typeof body === "object" &&
  body !== null &&
  (body as any).result === "failed";

const classifyFailure = (status: number, body: unknown): unknown => {
  if (isAuthGateBody(body)) {
    if (body.status === 401 || body.status === 403 || body.status === 400) {
      const Cls = HTTP_STATUS_MAP[body.status as 400 | 401 | 403];
      return new Cls({ message: body.message });
    }
  }
  if (isVendorExceptionBody(body)) {
    const { errorMessage: message, errorTitle: title, errorLevel } = body;
    if (errorLevel === "warning")
      return new OpnsenseUserWarning({ title, message });
    if (errorLevel === "info")
      return new OpnsenseUserNotice({ title, message });
    if (status === 404) {
      const Cls = HTTP_STATUS_MAP[404];
      return new Cls({ message });
    }
    if (errorLevel === "error" || title !== undefined)
      return new OpnsenseUserError({ title, message });
    const Cls = HTTP_STATUS_MAP[500];
    return new Cls({ message, code: undefined, retryAfter: undefined });
  }
  if (isResultFailedBody(body)) {
    const validations = (body.validations ?? {}) as Record<
      string,
      string | string[]
    >;
    return new ValidationFailed({ validations });
  }
  const StatusCls = (
    HTTP_STATUS_MAP as Record<number, (new (args: any) => any) | undefined>
  )[status];
  if (status >= 400 && StatusCls)
    return new StatusCls({ message: `HTTP ${status}` });
  return new UnknownOpnsenseError({ status, body });
};

const encode = ({
  input,
  inputAst,
}: {
  readonly input: unknown;
  readonly inputAst: AST.AST;
}) =>
  Effect.gen(function* () {
    const resolve = yield* Credentials;
    const creds: Config = yield* resolve;
    return buildRequest({
      input,
      inputAst,
      baseUrl: creds.apiBaseUrl,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.apiKey}:${Redacted.value(creds.apiSecret)}`).toString("base64")}`,
        Accept: "application/json",
      },
    });
  });

const decode = ({
  response,
  outputAst,
}: {
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly outputAst: AST.AST;
  readonly errors: ReadonlyArray<unknown>;
}) =>
  Effect.gen(function* () {
    const text = (yield* response.text.pipe(Effect.orDie)) ?? "";
    let json: unknown;
    let nonJson = false;
    if (text.trim().length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        nonJson = true;
      }
    }
    const status = response.status;
    const body = nonJson ? text : (json ?? {});

    // Success is NOT simply `status < 400` here: `{result:"failed"}` and the
    // UserWarning/UserInformational vendor-exception shapes are failures at
    // HTTP 200 (see module doc) — checked FIRST, before falling through to
    // "this 2xx body is the payload".
    if (
      status >= 400 ||
      isResultFailedBody(body) ||
      isVendorExceptionBody(body)
    ) {
      return yield* fail(classifyFailure(status, body));
    }
    return mapKeys(outputAst, body, "decode");
  });

export const OpnsenseProtocol: Layer.Layer<API.Protocol> = Layer.succeed(
  API.Protocol,
  API.Protocol.of({
    encode: (args) => encode(args) as Effect.Effect<any>,
    decode,
  }),
);
