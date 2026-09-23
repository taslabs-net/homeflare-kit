/**
 * Where the Paperless URL and token come from — S24's shape (alchemy-provider-standard): a lazy
 * `Context.Service` whose VALUE is itself an `Effect`, resolved inside each operation with
 * `yield* yield* PaperlessCredentials`. Resolving twice, not once at layer build, is what keeps a
 * token out of any state the engine might persist and lets a consumer swap the source (an env var
 * today, an OpenBao mint tomorrow) without touching a resource file.
 *
 * ⛔ NO DEFAULT HOST, AND NO DEFAULT TOKEN. A published package that fell back to a loopback
 *   address would let a consumer who forgot the variable watch every call fail against a machine
 *   that is not theirs, instead of being told which variable is missing.
 * ⛔ THE TOKEN IS NEVER A PROP, NEVER AN ATTRIBUTE. Alchemy persists attributes unencrypted
 *   (S25); nothing this family returns from `read`/`reconcile` may carry it.
 */
import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

export class PaperlessCredentialsError extends Data.TaggedError('PaperlessCredentialsError')<{
  readonly message: string;
}> {}

export interface PaperlessCredentialValue {
  /** Trailing slash stripped, e.g. `https://paperless.example.com`. */
  readonly url: string;
  readonly token: string;
}

/**
 * ★ `readEnvironment` NAMES EVERY VARIABLE IT CONSUMES (S24) — `PAPERLESS_URL`, `PAPERLESS_TOKEN`
 *   — so a consumer's `alchemy provider check-env` (or an equivalent preflight) can list them.
 */
const readEnvironment: Effect.Effect<PaperlessCredentialValue, PaperlessCredentialsError> =
  Effect.suspend(() => {
    const url = process.env['PAPERLESS_URL'];
    const token = process.env['PAPERLESS_TOKEN'];
    if (url === undefined || url.trim() === '') {
      return Effect.fail(
        new PaperlessCredentialsError({
          message: 'PAPERLESS_URL is not set. Point it at your Paperless-ngx instance.',
        }),
      );
    }
    if (token === undefined || token.trim() === '') {
      return Effect.fail(
        new PaperlessCredentialsError({
          message:
            'PAPERLESS_TOKEN is not set. Mint a scoped token and export it — never store it in Alchemy props.',
        }),
      );
    }
    return Effect.succeed({ token: token.trim(), url: url.trim().replace(/\/$/, '') });
  });

/**
 * The lazy service. ⚠️ `Layer.succeed` registers the EFFECT, not its result — `readEnvironment`
 *   runs once per `yield* yield*`, so a call after the variables are exported sees them even if
 *   the layer itself was built before that (true in `fake-paperless.test.ts`, which sets the env
 *   vars right before each call).
 */
export class PaperlessCredentials extends Context.Service<
  PaperlessCredentials,
  Effect.Effect<PaperlessCredentialValue, PaperlessCredentialsError>
>()('PaperlessCredentials') {}

export const environmentLayer: Layer.Layer<PaperlessCredentials> = Layer.succeed(
  PaperlessCredentials,
  readEnvironment,
);
