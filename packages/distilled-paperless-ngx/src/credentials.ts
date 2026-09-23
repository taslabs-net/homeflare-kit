/**
 * Paperless-ngx credentials — hand-written.
 *
 * The `Credentials` service resolves `{ token, apiBaseUrl }` per request; the
 * protocol layer formats the `Authorization: Token <token>` header from it.
 *
 * Paperless-ngx is self-hosted, so — like Forgejo and NetBox, and unlike a
 * single-tenant SaaS — there is no default API root: the instance URL is
 * part of the credential. The token is a Paperless-ngx API token (Django
 * admin → Auth Token, or `POST /api/token/` with a username/password), which
 * carries the same permissions as the user it belongs to — a plan-only
 * caller wants a user scoped to view-only groups, not a superuser token.
 *
 * ⚠️ LIKE NETBOX, UNLIKE FORGEJO: `apiBaseUrl` carries NO path suffix. The
 * pinned v3.1.1 document bakes `/api` into every path literally
 * (`/api/status/`, `/api/documents/`, …) — verified against
 * codegen/manifest.json's `paperless-openapi` entry, whose `sourcePath` is
 * itself `/api/schema/?format=json` — rather than declaring it as a
 * separate `basePath` the way Forgejo's Swagger document does. Appending
 * `/api` here a second time would repeat NetBox's measured `/api/api/…`
 * defect (see NetBox's own credentials.ts and homeflare-kit's
 * distilled-netbox smoke test), so `apiBaseUrl` is just the trimmed
 * instance origin, and `normalizeBaseUrl` strips one trailing `/api`
 * defensively for a caller who supplies it out of habit.
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
  // Linear on purpose: a `/\/+$/` regex backtracks polynomially on a long run
  // of "/" that is not at the end (CodeQL js/polynomial-redos, the exact
  // defect NetBox's sibling SDK fixed for this identical helper), and this
  // is caller input.
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  const trimmed = baseUrl.slice(0, end);
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
};

export interface Config {
  readonly token: Redacted.Redacted<string>;
  /** Instance origin, e.g. `https://paperless.example.com` (no path suffix). */
  readonly apiBaseUrl: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config>
>()("PaperlessNgxCredentials") {}

const envConfig = EffectConfig.all({
  // `PAPERLESS_URL` / `PAPERLESS_TOKEN` are the names homeflare-kit's own
  // hand-written Paperless family already reads
  // (packages/alchemy/src/paperless/credentials.ts), so a caller migrating
  // onto this SDK changes nothing about how credentials are supplied.
  token: EffectConfig.String("PAPERLESS_TOKEN"),
  baseUrl: EffectConfig.String("PAPERLESS_URL"),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "PAPERLESS_URL and PAPERLESS_TOKEN environment variables are required",
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
