/**
 * Grafana credentials for this family — a URL plus a TOKEN REFERENCE (an env var NAME), never a
 * literal secret. Wraps `@distilled.cloud/grafana`'s own `Credentials` context directly (S23 —
 * reuse the SDK's own client rather than inventing a second one); this file only adds the house's
 * lazy, per-instance resolution on top of it.
 *
 * ★ ONE `GRAFANA_TOKEN`/`GRAFANA_URL` PAIR ISN'T ENOUGH FOR THIS HOUSE. Unlike Forgejo (one
 *   instance), the estate runs at least two Grafanas — `grafana.homeflare.dev` and
 *   `teslamate-grafana` on CT100, which the unit's own comment says has "Own Access SaaS OIDC
 *   client, never grafana.homeflare.dev's". The SDK's `CredentialsFromEnv` reads one fixed pair
 *   of names, so a stack declaring against more than one instance needs a target per instance —
 *   `grafanaCredentials(target)` below, parameterized the way `litellm/credentials.ts` and
 *   `proxmox/credentials.ts` already are in this kit.
 *
 * ⛔ THE TOKEN NEVER TOUCHES A PROP OR AN ATTRIBUTE (S25). `tokenEnv` is a NAME, resolved from
 *   `process.env` fresh inside the credentials effect on every request (S24) — a layer built once
 *   still re-reads the environment each time an operation runs, the same laziness
 *   `litellm/credentials.ts` and the SDK's own `forgejo`/`netbox` `CredentialsFromEnv` have.
 *
 * ⚠️ THE SDK's `Credentials` SERVICE VALUE TYPE IS `Effect.Effect<Config, never, never>` — the
 *   error channel is `never` (credentials.d.ts). A missing env var can only surface as a defect
 *   here, via `Effect.orDie`, the same trade-off `forgejo/resource.ts` and `netbox/resource.ts`
 *   already accept for their own `CredentialsFromEnv`; it is not a choice this file introduces.
 */
import { type Config, Credentials } from '@distilled.cloud/grafana/Credentials';
import { ConfigError } from '@distilled.cloud/grafana/Errors';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';

export interface GrafanaTarget {
  /** Instance origin, e.g. `https://tesla.homeflare.dev/dash` — never `/api`; the SDK appends it. */
  readonly baseUrl: string;
  /** Env var NAME holding a Grafana service-account token. Never the value itself. */
  readonly tokenEnv: string;
  /** Selects the org a call applies to, via `X-Grafana-Org-Id`. Omit for the default org. */
  readonly orgId?: number | string;
}

const resolve = (target: GrafanaTarget): Effect.Effect<Config, never, never> =>
  Effect.sync(() => process.env[target.tokenEnv]).pipe(
    Effect.flatMap((raw) =>
      raw === undefined || raw.trim() === ''
        ? Effect.fail(
            new ConfigError({
              message:
                `${target.tokenEnv} is not set. Export the Grafana service-account token there ` +
                `— never as an Alchemy prop — before running a stack that declares a resource ` +
                `against ${target.baseUrl}.`,
            }),
          )
        : Effect.succeed({
            apiBaseUrl: target.baseUrl.replace(/\/+$/, ''),
            token: Redacted.make(raw.trim()),
            ...(target.orgId === undefined ? {} : { orgId: target.orgId }),
          } satisfies Config),
    ),
    Effect.orDie,
  );

/** The lazy, per-instance layer `grafanaProviders(target)` composes by default. */
export const grafanaCredentials = (target: GrafanaTarget): Layer.Layer<Credentials> =>
  Layer.succeed(Credentials, resolve(target));

export type { Credentials };
