/**
 * Argo CD credentials for this family — a URL plus a TOKEN REFERENCE (an env var NAME), never a
 * literal secret. Wraps `@distilled.cloud/argocd`'s own `Credentials` context (S23 / S24).
 *
 * ★ ONE `ARGOCD_TOKEN`/`ARGOCD_SERVER` PAIR IS THE SDK DEFAULT, and it is the wrong default for
 *   this house. Distilled's `CredentialsFromEnv` falls back to `https://localhost:8080` when
 *   `ARGOCD_SERVER` is unset — fine for `argocd port-forward`, fatal for a Talos cluster whose
 *   server is a placeholder origin a stack file must name. `argocdCredentials(target)` is the
 *   Grafana-shaped seam: one layer per instance, token read from `process.env` fresh on every
 *   request, never captured at module load.
 *
 * ⛔ THE TOKEN NEVER TOUCHES A PROP OR AN ATTRIBUTE (S25). `tokenEnv` is a NAME. Alchemy persists
 *   attributes unencrypted; a bearer token in state is a leaked cluster-admin credential.
 *
 * ⚠️ THE SDK `Credentials` VALUE TYPE IS `Effect.Effect<Config>` WITH ERROR `never`. A missing
 *   env var can only surface as a defect here (`Effect.orDie`), the same trade-off
 *   `../grafana/credentials.ts` already documents — it is not a choice this file introduces.
 */
import {
  type Config,
  Credentials,
  CredentialsFromEnv,
  fromToken,
} from '@distilled.cloud/argocd/Credentials';
import { ConfigError } from '@distilled.cloud/argocd/Errors';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

export interface ArgoCDTarget {
  /** Instance origin, e.g. `https://argocd.example.com` — never `/api/v1`; the SDK appends it. */
  readonly baseUrl: string;
  /** Env var NAME holding an Argo CD bearer token. Never the value itself. */
  readonly tokenEnv: string;
}

const resolve = (target: ArgoCDTarget): Effect.Effect<Config, never, never> =>
  Effect.sync(() => process.env[target.tokenEnv]).pipe(
    Effect.flatMap((raw) =>
      raw === undefined || raw.trim() === ''
        ? Effect.fail(
            new ConfigError({
              message:
                `${target.tokenEnv} is not set. Export the Argo CD bearer token there ` +
                `— never as an Alchemy prop — before running a stack that declares a resource ` +
                `against ${target.baseUrl}.`,
            }),
          )
        : Effect.succeed({
            apiBaseUrl: target.baseUrl.replace(/\/+$/, ''),
            token: Redacted.make(raw.trim()),
          } satisfies Config),
    ),
    Effect.orDie,
  );

/** The lazy, per-instance layer `argocdProviders(target)` composes by default. */
export const argocdCredentials = (target: ArgoCDTarget): Layer.Layer<Credentials> =>
  Layer.succeed(Credentials, resolve(target));

export { Credentials, CredentialsFromEnv, fromToken };
export type { Config as ArgoCDCredentialsConfig };
