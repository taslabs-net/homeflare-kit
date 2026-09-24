/**
 * STUB — Traefik dashboard API credentials. Hand-written scaffold; replaced
 * when `src/` is regenerated from a Distilled convert+generate cycle.
 *
 * Traefik's own API handler has no authentication. Production installs put
 * basicAuth / digestAuth / forwardAuth in front of `api@internal` (docs:
 * https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/).
 * `authorization` is that front-door header when the caller has one; omit it
 * for the insecure `:8080` listener (`api.insecure: true`).
 *
 * Default origin is Traefik's insecure API entrypoint. Paths in this stub
 * already start with `/api/…`, so nothing is appended here.
 */
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

/** Traefik insecure API listener (`--api.insecure`, entrypoint `traefik`). */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8080';

export interface Config {
  readonly apiBaseUrl: string;
  /** Optional `Authorization` value presented to a front-door middleware. */
  readonly authorization?: Redacted.Redacted<string>;
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
  'TraefikCredentials',
) {}

/** Layer from an explicit origin and optional front-door Authorization. */
export const fromApiBaseUrl = (config: {
  readonly apiBaseUrl?: string;
  readonly authorization?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl ?? DEFAULT_API_BASE_URL),
      authorization:
        config.authorization === undefined ? undefined : Redacted.make(config.authorization),
    }),
  );

/**
 * Reads TRAEFIK_API_BASE_URL (optional) and TRAEFIK_API_AUTHORIZATION
 * (optional). Defaults to {@link DEFAULT_API_BASE_URL} with no auth header.
 */
export const CredentialsFromEnv: Layer.Layer<Credentials> = Layer.succeed(
  Credentials,
  Effect.succeed({
    apiBaseUrl: normalizeBaseUrl(process.env.TRAEFIK_API_BASE_URL ?? DEFAULT_API_BASE_URL),
    authorization:
      process.env.TRAEFIK_API_AUTHORIZATION === undefined
        ? undefined
        : Redacted.make(process.env.TRAEFIK_API_AUTHORIZATION),
  }),
);
