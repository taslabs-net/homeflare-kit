/**
 * Proxmox VE credentials — hand-written.
 *
 * The `Credentials` service resolves `{ tokenId, secret, apiBaseUrl }` per
 * request; the protocol layer formats the `Authorization:
 * PVEAPIToken=<tokenId>=<secret>` header from it.
 *
 * PVE is self-hosted (a cluster node, not a single-tenant SaaS), so — like
 * `@distilled.cloud/forgejo` — there is no default API root: the instance
 * URL is part of the credential. `tokenId` is the FULL
 * `<user>@<realm>!<tokenid>` string PVE prints when an API token is
 * created (`pveum user token add …`); `secret` is the value shown exactly
 * once at creation time.
 */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

/** PVE's own API root, relative to the node origin. Always port 8006, always `/api2/json`. */
export const API_PATH = "/api2/json";

/**
 * Normalize a node origin (or an already-complete API root) into the API
 * base URL: trailing slashes dropped, {@link API_PATH} appended exactly
 * once. Does NOT default the port — `https://pve.example.com:8006` (or a
 * bare host, which the caller must have already put a scheme+port on) is
 * expected, matching how the kit's own `PveTarget` is built per node/vip.
 *
 * ⛔ THE TRIM IS A LOOP, NEVER `/\/+$/`. That regex backtracks
 *   polynomially on a long run of trailing `/` (CodeQL `js/polynomial-
 *   redos`) — caller input, so a real DoS surface, not a hypothetical one.
 *   Measured the same fix already landed in `@homeflare/distilled-netbox`'s
 *   identical trim (`taslabs-net/homeflare-kit` PR 184): 0 mismatches
 *   against the old regex over 13 edge cases and 20,000 random inputs, a
 *   100,000-slash input in 0.01ms linear.
 */
export const normalizeBaseUrl = (baseUrl: string): string => {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47 /* "/" */) end--;
  const trimmed = baseUrl.slice(0, end);
  return trimmed.endsWith(API_PATH) ? trimmed : `${trimmed}${API_PATH}`;
};

export interface Config {
  /** The full `<user>@<realm>!<tokenid>` string, e.g. `root@pam!terraform`. */
  readonly tokenId: string;
  readonly secret: Redacted.Redacted<string>;
  /** Fully-qualified API root, e.g. `https://pve1.example.com:8006/api2/json`. */
  readonly apiBaseUrl: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("ProxmoxCredentials") {}

const envConfig = EffectConfig.all({
  tokenId: EffectConfig.String("PROXMOX_TOKEN_ID"),
  secret: EffectConfig.Redacted("PROXMOX_TOKEN_SECRET"),
  baseUrl: EffectConfig.String("PROXMOX_URL"),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "PROXMOX_URL, PROXMOX_TOKEN_ID and PROXMOX_TOKEN_SECRET environment variables are required",
        }),
    ),
    Effect.map(({ tokenId, secret, baseUrl }) => ({
      tokenId,
      secret,
      apiBaseUrl: normalizeBaseUrl(baseUrl),
    })),
    Effect.orDie,
  ),
);

/** Convenience layer from a plain token and the node origin (or API root). */
export const credentials = (config: {
  readonly tokenId: string;
  readonly secret: string | Redacted.Redacted<string>;
  readonly baseUrl: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      tokenId: config.tokenId,
      secret:
        typeof config.secret === "string"
          ? Redacted.make(config.secret)
          : config.secret,
      apiBaseUrl: normalizeBaseUrl(config.baseUrl),
    }),
  );
