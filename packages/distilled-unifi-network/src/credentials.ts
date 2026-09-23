/**
 * UniFi Network credentials — hand-written.
 *
 * The `Credentials` service resolves `{ apiKey, apiBaseUrl }` per request;
 * the protocol layer sends it as the `X-API-KEY` header. UniFi Network is
 * console-hosted (a local controller, or Ubiquiti's cloud connector proxying
 * to one), so — like Forgejo — there is no default API root: the console's
 * address IS part of the credential, and the caller supplies it exactly.
 *
 * Two console shapes exist, both valid `apiBaseUrl` values (the generated
 * operations' routes already start with `/v1/...`, matching the OpenAPI
 * document's `paths`, so nothing is appended here):
 *
 *   - Local console:    `https://<console-ip>/proxy/network/integration`
 *   - Cloud connector:  `https://api.ui.com/v1/connector/consoles/<consoleId>/proxy/network/integration`
 *
 * `<consoleId>` is an account identifier — never log, commit, or otherwise
 * persist an `apiBaseUrl` that contains one outside of the caller's own
 * runtime configuration.
 *
 * ⛔ AUTHENTICATION IS NOT DOCUMENTED IN THE SPEC: `network_v10.4.57_openapi.json`
 * declares no `components.securitySchemes` and no operation carries a
 * `security` requirement — the `X-API-KEY` header below comes from
 * Ubiquiti's own Integration API guide (https://developer.ui.com/unifi-integration-api-guide/),
 * not from the machine-readable description. Re-verify this against a live
 * console (a request without it should 401) before depending on it in
 * anything that writes.
 *
 * The key itself is an Integrations → API Key created in the console's own
 * UI (Settings → Control Plane → Integrations on a local console). It is a
 * SECRET: callers that adopt this package into the kit read it from OpenBao
 * at call time and pass a reference, never a literal value in state — see
 * the package README's "Secrets" section.
 *
 * ⚠️ TLS is this package's caller's problem, not this package's: a local
 * console's certificate is self-signed by default (the cloud connector's is
 * not). `Credentials` carries no TLS configuration — trust decisions belong
 * to the `HttpClient` layer the caller provides (a custom agent pinning the
 * console's cert, or an explicit opt-in to skip verification for a known
 * LAN address), never hard-coded here.
 */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

export interface Config {
  readonly apiKey: Redacted.Redacted<string>;
  /**
   * Fully-qualified integration API root for one console, e.g.
   * `https://192.168.1.1/proxy/network/integration`. No default: every
   * caller names its own console.
   */
  readonly apiBaseUrl: string;
}

/** Drop a trailing slash; the base URL carries no other structure to fix up. */
const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "");

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("UnifiNetworkCredentials") {}

const envConfig = EffectConfig.all({
  apiKey: EffectConfig.String("UNIFI_NETWORK_API_KEY"),
  apiBaseUrl: EffectConfig.String("UNIFI_NETWORK_API_BASE_URL"),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "UNIFI_NETWORK_API_BASE_URL and UNIFI_NETWORK_API_KEY environment variables are required",
        }),
    ),
    Effect.map(({ apiKey, apiBaseUrl }) => ({
      apiKey: Redacted.make(apiKey),
      apiBaseUrl: normalizeBaseUrl(apiBaseUrl),
    })),
    Effect.orDie,
  ),
);

/** Convenience layer from a plain API key and the console's integration API root. */
export const credentials = (config: {
  readonly apiKey: string | Redacted.Redacted<string>;
  readonly apiBaseUrl: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey:
        typeof config.apiKey === "string"
          ? Redacted.make(config.apiKey)
          : config.apiKey,
      apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl),
    }),
  );
