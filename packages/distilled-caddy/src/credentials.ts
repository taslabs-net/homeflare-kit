/**
 * Caddy admin API credentials — hand-written.
 *
 * The admin API has NO AUTHENTICATION (caddyserver/caddy v2.11.4 admin.go —
 * `newAdminHandler` never wires an auth check into the local/plaintext
 * listener; only the separate `admin.remote` mTLS listener on :2021, which
 * this package does not speak, requires identity). Caddy protects the local
 * endpoint by binding to loopback or a unix socket and checking the `Host`
 * and `Origin` headers against its own listen address instead
 * (admin.go `checkHost`/`checkOrigin`, `allowedOrigins`). So there is no API
 * key here — `Config` only carries where the admin API is and what `Host`
 * (and `Origin`) header to present.
 *
 * `apiBaseUrl` names the endpoint but does NOT choose the transport: this
 * package's `Credentials` never dials a socket itself, matching Docker's
 * package (`packages/docker/src/credentials.ts`) — the CALLER's
 * `HttpClient.Layer` decides whether `apiBaseUrl`'s host resolves over TCP
 * or is a stand-in for a `unix:///path` dial target (see the kit's
 * `localCaddyAdmin()`, `packages/alchemy/src/caddy/local-admin.ts`, which
 * already builds one over `node:http`). `hostHeader` exists because Caddy
 * checks `Host` against ITS OWN listen address, not the caller's: an
 * SSH-forwarded port, or a Caddyfile that narrows `admin { origins … }`,
 * needs the header set to what Caddy expects rather than derived from
 * `apiBaseUrl` (kit `docs/caddy-admin.md`, measured against Caddy 2.11.4:
 * any other Host answers `403 host not allowed`).
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Caddy's own default admin listener (`localhost:2019`, DefaultAdminListen in admin.go). */
export const DEFAULT_API_BASE_URL = "http://127.0.0.1:2019";

export interface Config {
  readonly apiBaseUrl: string;
  /**
   * `Host` (and, over TCP, `Origin`) to send — `host:port` form. Defaults to
   * `apiBaseUrl`'s own host:port. Set this when the admin API is reached
   * through a forwarded port or a narrowed `admin { origins … }` Caddyfile
   * block, so the header matches what CADDY checks against, not what this
   * client dialed.
   */
  readonly hostHeader?: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("CaddyCredentials") {}

/** Layer from an explicit base URL (and optional Host header override). */
export const fromApiBaseUrl = (config: {
  readonly apiBaseUrl?: string;
  readonly hostHeader?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiBaseUrl: config.apiBaseUrl ?? DEFAULT_API_BASE_URL,
      hostHeader: config.hostHeader,
    }),
  );

/**
 * Reads CADDY_ADMIN_API_BASE_URL (optional) and CADDY_ADMIN_HOST_HEADER
 * (optional). Defaults to {@link DEFAULT_API_BASE_URL} with no Host override.
 */
export const CredentialsFromEnv: Layer.Layer<Credentials> = Layer.succeed(
  Credentials,
  Effect.succeed({
    apiBaseUrl: process.env.CADDY_ADMIN_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    hostHeader: process.env.CADDY_ADMIN_HOST_HEADER,
  }),
);
