/**
 * OpenBao credentials — hand-written.
 *
 * The `Credentials` service resolves `{ token, apiBaseUrl, namespace }` per
 * request; the protocol layer formats the `X-Vault-Token` (and, when set,
 * `X-Vault-Namespace`) headers from it.
 *
 * OpenBao is self-hosted, so — unlike a single-tenant SaaS — there is no
 * default API root: the address is part of the credential, same shape as
 * `@distilled.cloud/forgejo`'s `FORGEJO_URL`/`FORGEJO_TOKEN`. The env var
 * names (`BAO_ADDR`, `BAO_TOKEN`, `BAO_NAMESPACE`) match the kit's own
 * `packages/alchemy/src/openbao/bao-address.ts` and the `bao` CLI itself.
 */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

/**
 * API path prefix — every OpenBao route is documented "prefixed with
 * `/v1/`" (the generated spec's own `info.description`). It is a fixed path
 * segment, not a header, so it belongs to the base URL exactly as Forgejo's
 * `API_PATH` does.
 */
export const API_PATH = "/v1";

/**
 * Drop trailing slashes; the address carries no other structure to fix up.
 * A loop, not `/\/+$/`: that regex backtracks polynomially on a long run of
 * `/` (CodeQL js/polynomial-redos, alert 15 on kit PR 263) — the same fix
 * as distilled-netbox's and distilled-unifi-network's `normalizeBaseUrl`.
 */
const trimTrailingSlashes = (addr: string): string => {
  let end = addr.length;
  while (end > 0 && addr.charCodeAt(end - 1) === 47) end--;
  return addr.slice(0, end);
};

/** Normalize an address (or an already-complete `/v1` root) into the API base URL. */
export const normalizeBaseUrl = (addr: string): string => {
  const trimmed = trimTrailingSlashes(addr);
  return trimmed.endsWith(API_PATH) ? trimmed : `${trimmed}${API_PATH}`;
};

export interface Config {
  /** Absent for a local agent listener that supplies its own identity. */
  readonly token?: Redacted.Redacted<string>;
  /** Fully-qualified API root, e.g. `http://127.0.0.1:8200/v1`. */
  readonly apiBaseUrl: string;
  /** `X-Vault-Namespace`, when the estate uses one. Absent = root namespace. */
  readonly namespace?: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("OpenBaoCredentials") {}

const envConfig = EffectConfig.all({
  token: EffectConfig.String("BAO_TOKEN").pipe(EffectConfig.option),
  addr: EffectConfig.String("BAO_ADDR"),
  namespace: EffectConfig.String("BAO_NAMESPACE").pipe(EffectConfig.option),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message: "BAO_ADDR environment variable is required",
        }),
    ),
    Effect.map(({ token, addr, namespace }) => ({
      token:
        token.valueOrUndefined === undefined
          ? undefined
          : Redacted.make(token.valueOrUndefined),
      apiBaseUrl: normalizeBaseUrl(addr),
      namespace: namespace.valueOrUndefined,
    })),
    Effect.orDie,
  ),
);

/** Convenience layer from a plain token, address and optional namespace. */
export const credentials = (config: {
  readonly token?: string | Redacted.Redacted<string>;
  readonly addr: string;
  readonly namespace?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      token:
        typeof config.token === "string"
          ? Redacted.make(config.token)
          : config.token,
      apiBaseUrl: normalizeBaseUrl(config.addr),
      namespace: config.namespace,
    }),
  );
