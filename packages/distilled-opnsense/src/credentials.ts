/**
 * OPNsense credentials — hand-written.
 *
 * OPNsense authenticates its `/api/*` surface with a key/secret pair sent
 * as HTTP Basic auth: `Authorization: Basic base64(key:secret)` — verified
 * both in source (`ApiControllerBase::beforeExecuteRoute`, mirrored at
 * `specs/core/models/Base/ApiControllerBase.php`: it splits the decoded
 * Basic-auth payload on `:` into `apiKey`/`apiSecret`, and works with ANY
 * scheme word before the base64 blob, not just literally `Basic`) and in
 * the vendor's own docs (`opnsense/docs`, `source/development/how-tos/
 * api.rst`: a `curl -u <api-key>:<api-secret>` example against `.../api/...`,
 * and the Python sample's `requests.get(..., auth=(api_key, api_secret))` — `requests`'
 * `auth=` tuple IS HTTP Basic). The secret is generated once per key in the
 * user manager and cannot be re-downloaded, so it is credential-shaped, not
 * password-shaped — `Redacted` like a token, never compared or logged.
 *
 * Self-hosted, like Forgejo: there is no default host, so the edge/router's
 * origin is part of the credential, not a hardcoded base URL.
 */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

/**
 * OPNsense's own path prefix; every generated route's `T.Http({ uri })`
 * already carries it (e.g. `/api/quagga/general/get` — see any
 * `src/services/*.ts`), because it is the vendor's own real wire path, not
 * an artifact of this converter. `buildRequest` in
 * `@distilled.cloud/core/protocol-http` concatenates `baseUrl + uri`
 * verbatim with no de-duplication, so `apiBaseUrl` MUST be the bare origin
 * — appending `API_PATH` here as well produced a real, smoke-test-caught
 * `/api/api/...` request (see `../scripts/smoke.ts` and
 * `../README.md`'s "Known limitations"). `normalizeBaseUrl` therefore
 * STRIPS a trailing `/api` a caller may have included (the doc comment on
 * `Config.apiBaseUrl` below used to invite exactly that input), rather than
 * adding one.
 */
export const API_PATH = "/api";

/** Normalize an OPNsense origin (or an already-complete `/api` root, accepted for caller convenience) down to the bare origin every generated route's own `uri` already assumes. */
export const normalizeBaseUrl = (baseUrl: string): string => {
  // A loop, not a trailing-slash regex: that backtracks polynomially on a long
  // run of "/" (CodeQL js/polynomial-redos), the same fix as distilled-netbox's.
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  const trimmed = baseUrl.slice(0, end);
  return trimmed.endsWith(API_PATH)
    ? trimmed.slice(0, -API_PATH.length)
    : trimmed;
};

export interface Config {
  readonly apiKey: string;
  readonly apiSecret: Redacted.Redacted<string>;
  /** Bare origin, e.g. `https://edge.homeflare.dev` or `https://10.20.10.1` — a trailing `/api` is accepted and stripped, never doubled with a route's own `/api/...` prefix. */
  readonly apiBaseUrl: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("OpnsenseCredentials") {}

const envConfig = EffectConfig.all({
  // No vendor-standard env var names exist for OPNsense's API (unlike
  // Forgejo's own `FORGEJO_URL`/`FORGEJO_TOKEN`) — these follow this SDK's
  // own naming.
  apiKey: EffectConfig.String("OPNSENSE_API_KEY"),
  apiSecret: EffectConfig.String("OPNSENSE_API_SECRET"),
  baseUrl: EffectConfig.String("OPNSENSE_URL"),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "OPNSENSE_URL, OPNSENSE_API_KEY and OPNSENSE_API_SECRET environment variables are required",
        }),
    ),
    Effect.map(({ apiKey, apiSecret, baseUrl }) => ({
      apiKey,
      apiSecret: Redacted.make(apiSecret),
      apiBaseUrl: normalizeBaseUrl(baseUrl),
    })),
    Effect.orDie,
  ),
);

/** Convenience layer from a plain key/secret and the box's origin (or API root). */
export const credentials = (config: {
  readonly apiKey: string;
  readonly apiSecret: string | Redacted.Redacted<string>;
  readonly baseUrl: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: config.apiKey,
      apiSecret:
        typeof config.apiSecret === "string"
          ? Redacted.make(config.apiSecret)
          : config.apiSecret,
      apiBaseUrl: normalizeBaseUrl(config.baseUrl),
    }),
  );
