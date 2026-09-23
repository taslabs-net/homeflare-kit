/**
 * NetBox credentials — hand-written.
 *
 * The `Credentials` service resolves `{ token, apiBaseUrl }` per request; the
 * protocol layer formats the `Authorization: Token <token>` header from it.
 *
 * NetBox is self-hosted, so — like Forgejo, and unlike a single-tenant SaaS —
 * there is no default API root: the instance URL is part of the credential.
 * The token is a NetBox API token (Admin → API Tokens), which can be scoped
 * read-only and IP-restricted; a plan-only caller wants both.
 *
 * ⚠️ UNLIKE FORGEJO, `apiBaseUrl` carries NO path suffix. NetBox's OpenAPI
 * document bakes `/api` into every path literally (`/api/status/`,
 * `/api/dcim/sites/`, …) rather than declaring it as a separate `basePath`
 * the way Forgejo's Swagger document does — so the generated operations'
 * routes are already fully rooted, and appending `/api` here a second time
 * produced `…/api/api/status/` (caught by scripts/smoke.ts in the
 * `homeflare-kit` copy of this package, which builds and inspects a real
 * request rather than only typechecking). `apiBaseUrl` is therefore just the
 * trimmed instance origin — the same shape Kubernetes' credentials use.
 *
 * ⚠️ Forgejo's sibling SDK uses the OPPOSITE convention (`apiBaseUrl`
 * WITHOUT `/api`, appended by the SDK) in the same ecosystem, which is
 * exactly the confusion that produced the bug above — so `normalizeBaseUrl`
 * also strips one trailing `/api` segment defensively: a caller who sets
 * `NETBOX_URL=https://netbox.example.com/api` out of habit (or by copying a
 * Forgejo-style value) still gets the correct base, instead of a silently
 * wrong `…/api/api/…` that surfaces as a confusing 404.
 */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

/**
 * Normalize an instance origin into the API base URL: trailing slashes
 * dropped, and a trailing `/api` segment stripped if present (nothing is
 * ever appended — see the module doc for why not).
 */
export const normalizeBaseUrl = (baseUrl: string): string => {
  // Linear on purpose: a `/\/+$/` regex backtracks polynomially on a long run of
  // "/" that is not at the end (CodeQL js/polynomial-redos), and this is caller input.
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  const trimmed = baseUrl.slice(0, end);
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
};

export interface Config {
  readonly token: Redacted.Redacted<string>;
  /** Instance origin, e.g. `https://netbox.example.com` (no path suffix). */
  readonly apiBaseUrl: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("NetboxCredentials") {}

const envConfig = EffectConfig.all({
  // `NETBOX_URL` / `NETBOX_TOKEN` are the names this estate's own NetBox
  // family (`homeflare-kit` packages/alchemy/src/netbox/client.ts) already
  // reads, so a caller migrating onto this SDK changes nothing about how
  // credentials are supplied.
  token: EffectConfig.String("NETBOX_TOKEN"),
  baseUrl: EffectConfig.String("NETBOX_URL"),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "NETBOX_URL and NETBOX_TOKEN environment variables are required",
        }),
    ),
    Effect.map(({ token, baseUrl }) => ({
      token: Redacted.make(token),
      apiBaseUrl: normalizeBaseUrl(baseUrl),
    })),
    Effect.orDie,
  ),
);

/**
 * Convenience layer from a plain token and the instance origin.
 */
export const credentials = (config: {
  readonly token: string | Redacted.Redacted<string>;
  readonly baseUrl: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      token:
        typeof config.token === "string"
          ? Redacted.make(config.token)
          : config.token,
      apiBaseUrl: normalizeBaseUrl(config.baseUrl),
    }),
  );
