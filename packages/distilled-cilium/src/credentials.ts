/**
 * STUB — Cilium agent API credentials. Hand-written scaffold; replaced when
 * `src/` is regenerated from Cilium's official OpenAPI
 * (`cilium/cilium` `api/v1/openapi.yaml`, swagger 2.0, `basePath: /v1`,
 * `x-schemes: [unix]`).
 *
 * The agent API is served on a local unix socket
 * (`/var/run/cilium/cilium.sock`) with no HTTP authentication. This
 * package never dials the socket — matching Caddy and Docker — the
 * caller's `HttpClient` layer decides whether `apiBaseUrl` is a TCP
 * stand-in or a `unix:///path` dial target.
 *
 * Paths in this stub already start with `/v1/…`.
 */
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

/** TCP stand-in. Callers that speak the unix socket override this. */
export const DEFAULT_API_BASE_URL = 'http://localhost';

export interface Config {
  readonly apiBaseUrl: string;
}

/**
 * Drop trailing slashes. A loop, not `/\/+$/`: that regex backtracks
 * polynomially on a long run of `/` (CodeQL js/polynomial-redos), the same
 * fix as distilled-netbox's.
 */
const normalizeBaseUrl = (baseUrl: string): string => {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  return baseUrl.slice(0, end);
};

export class Credentials extends Context.Service<Credentials, Effect.Effect<Config>>()(
  'CiliumCredentials',
) {}

/** Layer from an explicit agent API origin. */
export const fromApiBaseUrl = (config: {
  readonly apiBaseUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl ?? DEFAULT_API_BASE_URL),
    }),
  );

/**
 * Reads CILIUM_API_BASE_URL (optional). Defaults to
 * {@link DEFAULT_API_BASE_URL}.
 */
export const CredentialsFromEnv: Layer.Layer<Credentials> = Layer.succeed(
  Credentials,
  Effect.succeed({
    apiBaseUrl: normalizeBaseUrl(process.env.CILIUM_API_BASE_URL ?? DEFAULT_API_BASE_URL),
  }),
);
