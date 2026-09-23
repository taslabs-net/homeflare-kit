/**
 * The lazy Auth service every LiteLLM call reads from, and nothing else reads the environment.
 *
 * ★ LITELLM'S OWN VARIABLE NAMES, NOT A HOUSE CHOICE. `LITELLM_PROXY_URL` and
 *   `LITELLM_PROXY_API_KEY` are what LiteLLM's own CLI client reads
 *   (litellm/proxy/client/cli/main.py:70,78 at tag v1.100.0) — using the vendor's own names means
 *   a consumer who already has a `.env` for the `litellm` CLI needs nothing new for this package.
 * ⛔ NO DEFAULT URL. A published package that fell back to a loopback address would let a
 *   consumer who forgot the variable watch every call fail against a proxy that is not theirs,
 *   instead of being told which variable is missing (S24/S25 — the house rule, not a vendor one).
 * ⛔ THE KEY IS NEVER A PROP. Alchemy persists attributes unencrypted (S25); the master key that
 *   `update_config_general_settings` requires (PROXY_ADMIN only, proxy_server.py:16411 at the
 *   tag) is read fresh from the environment on every call, never stored in state.
 * ★ LAZY: the service's VALUE is an `Effect` that resolves the credential, not the credential
 *   itself — so a layer built once still reads the environment inside each operation
 *   (`yield* yield* LitellmCredentials`), the idiom `alchemy/Auth`'s custom-auth-provider guide
 *   describes for a credential a layer must not capture at build time.
 */
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

export const LITELLM_PROXY_URL_ENV = 'LITELLM_PROXY_URL';
export const LITELLM_PROXY_API_KEY_ENV = 'LITELLM_PROXY_API_KEY';

export interface LitellmCreds {
  /** Trailing slash stripped. No default — see the header. */
  readonly baseUrl: string;
  /** LiteLLM's master (or a PROXY_ADMIN) key. Never logged, never an attribute. */
  readonly apiKey: string;
}

export class LitellmCredentialsError extends Data.TaggedError('LitellmCredentialsError')<{
  readonly message: string;
}> {}

const missing = (name: string): LitellmCredentialsError =>
  new LitellmCredentialsError({
    message:
      `${name} is not set. Export it — the same variable LiteLLM's own \`litellm\` CLI ` +
      'reads — before running a stack that declares a LiteLLM.PassThroughEndpoint.',
  });

/** Read at call time. Exported so a test can call it directly against `process.env`. */
export const resolveCreds: Effect.Effect<LitellmCreds, LitellmCredentialsError> = Effect.gen(
  function* () {
    const rawUrl = process.env[LITELLM_PROXY_URL_ENV];
    if (rawUrl === undefined || rawUrl.trim() === '')
      return yield* Effect.fail(missing(LITELLM_PROXY_URL_ENV));
    const rawKey = process.env[LITELLM_PROXY_API_KEY_ENV];
    if (rawKey === undefined || rawKey.trim() === '') {
      return yield* Effect.fail(missing(LITELLM_PROXY_API_KEY_ENV));
    }
    return { baseUrl: rawUrl.trim().replace(/\/$/, ''), apiKey: rawKey.trim() };
  },
);

/** The Effect service a LiteLLM operation reads: `yield* yield* LitellmCredentials`. */
export class LitellmCredentials extends Context.Service<
  LitellmCredentials,
  Effect.Effect<LitellmCreds, LitellmCredentialsError>
>()('homeflare/litellm/Credentials') {}

/** The default layer: resolves from the environment, fresh, on every `yield*`. */
export const litellmCredentialsLayer: Layer.Layer<LitellmCredentials> = Layer.succeed(
  LitellmCredentials,
  resolveCreds,
);

/** For a test: a fixed credential, never touching the environment. */
export const litellmCredentialsLayerFor = (creds: LitellmCreds): Layer.Layer<LitellmCredentials> =>
  Layer.succeed(LitellmCredentials, Effect.succeed(creds));
