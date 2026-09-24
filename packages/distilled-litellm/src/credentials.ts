/**
 * LiteLLM credentials — hand-written.
 *
 * The `Credentials` service resolves `{ apiKey, apiBaseUrl }` per request;
 * the protocol layer formats the `Authorization: Bearer <apiKey>` header
 * from it.
 *
 * LiteLLM Proxy is self-hosted, so — like Forgejo, and unlike a
 * single-tenant SaaS — there is no default API root: the instance URL is
 * part of the credential. `apiKey` is either the proxy's own master key
 * (`general_settings.master_key` / `LITELLM_MASTER_KEY`) or a virtual key
 * with the `proxy_admin` role — every `/key`, `/team`, `/user`, `/budget`,
 * `/model` and `/config` mutation this package's services reach requires
 * `user_api_key_dict.user_role == PROXY_ADMIN`
 * (`litellm/proxy/auth/user_api_key_auth.py`, `proxy_server.py`'s
 * `update_config_general_settings` at tag `v1.100.0` — see `protocol.ts`).
 * A read-scoped virtual key can call the list/info GETs but every mutation
 * answers `401` (LiteLLM does not distinguish "wrong key" from
 * "right key, wrong role" — see `errors.ts`).
 */
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ConfigError } from "@distilled.cloud/core/errors";

export interface Config {
  readonly apiKey: Redacted.Redacted<string>;
  /** The proxy's origin, trailing slash stripped. No default — see the header. */
  readonly apiBaseUrl: string;
}

export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<Config, ConfigError>
>()("LitellmCredentials") {}

const normalizeBaseUrl = (baseUrl: string): string => {
  // Linear on purpose: a `/\/+$/` regex backtracks polynomially on a long run of
  // "/" that is not at the end (CodeQL js/polynomial-redos, the same defect
  // NetBox's and Paperless-ngx's sibling SDKs already fixed for this identical
  // helper), and this is caller input.
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  return baseUrl.slice(0, end);
};

const envConfig = EffectConfig.all({
  // `LITELLM_PROXY_URL` / `LITELLM_PROXY_API_KEY` are the names LiteLLM's
  // own `litellm` CLI client reads (`litellm/proxy/client/cli/main.py` at
  // the tag) — using the vendor's own names means a consumer who already
  // has a `.env` for the `litellm` CLI needs nothing new for this package.
  apiKey: EffectConfig.String("LITELLM_PROXY_API_KEY"),
  baseUrl: EffectConfig.String("LITELLM_PROXY_URL"),
});

export const CredentialsFromEnv = Layer.succeed(
  Credentials,
  envConfig.pipe(
    // Typed failure (S20/S24), not `Effect.orDie` — `LitellmOpError` already
    // declares `ConfigError` (protocol.ts), and `makeRestProtocol`'s `encode`
    // step (`core/src/protocol-rest.ts`) `yield*`s this effect on the calling
    // fiber and lets a real failure flow into the operation's own error
    // channel; dying here only defeats that path; it does not avoid it. A
    // missing/misspelled `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY` is a
    // refusal a caller (`alchemy plan`/`deploy`) can catch and report, not an
    // engine-crashing defect.
    Effect.mapError(
      () =>
        new ConfigError({
          message:
            "LITELLM_PROXY_URL and LITELLM_PROXY_API_KEY environment variables are required",
        }),
    ),
    Effect.map(({ apiKey, baseUrl }) => ({
      apiKey: Redacted.make(apiKey),
      apiBaseUrl: normalizeBaseUrl(baseUrl),
    })),
  ),
);

/**
 * Convenience layer from a plain key and the proxy's origin.
 *
 * ⛔ THE KEY IS NEVER A PROP (house rule, S25 — Alchemy persists attributes
 * unencrypted). A caller building this layer from a stack should read the
 * key fresh from the environment/a secret store, never from committed
 * state.
 */
export const credentials = (config: {
  readonly apiKey: string | Redacted.Redacted<string>;
  readonly baseUrl: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey:
        typeof config.apiKey === "string"
          ? Redacted.make(config.apiKey)
          : config.apiKey,
      apiBaseUrl: normalizeBaseUrl(config.baseUrl),
    }),
  );
