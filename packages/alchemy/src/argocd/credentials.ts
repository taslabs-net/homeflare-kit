/**
 * Argo CD credentials — a bearer-token REFERENCE, resolved lazily, never a prop.
 *
 * ⛔ NO TOKEN IS EVER A PROP OR AN ATTRIBUTE. Alchemy persists Attributes unencrypted
 *   (State/StateEncoding.ts@v2.0.0-beta.79#encodeState), so nothing a stack file holds may be a
 *   credential. `@distilled.cloud/argocd/Credentials` already ships exactly the shape this asks
 *   for: `Credentials` is a lazy `Context.Service<Credentials, Effect.Effect<Config>>`, resolved
 *   on the calling fiber inside each operation (`ArgocdProtocol`'s `credentials:` field), never at
 *   layer build. This file re-exports it rather than re-implementing it — the same choice
 *   `../discord/credentials.ts` and `../forgejo` (via `@distilled.cloud/forgejo/Credentials`) made.
 *
 * ★ `CredentialsFromEnv` reads `ARGOCD_TOKEN` (required) and `ARGOCD_SERVER` (optional instance
 *   origin, default `https://localhost:8080`) — the distilled package's own names, unchanged here
 *   so a consumer never has to guess which var this family reads.
 *
 * ⚠️ NO `credentials(...)` FACTORY EXISTS ON THIS SDK, unlike Discord/Grafana's — measured against
 *   `packages/argocd/src/credentials.ts` (distilled homeflare/base): only `fromToken({ token,
 *   apiBaseUrl? })` and `CredentialsFromEnv`. `fake-argocd.ts` builds its test layer from
 *   `fromToken` directly.
 *
 * ⚠️ NO OpenBao MINT YET, same as every other family in this kit today (`Alchemy.Stack({ secrets
 *   })` is unreleased, PR 1728, `main`-only). A deploy process exports `ARGOCD_TOKEN` itself —
 *   this package never reads it from a file.
 *
 * ⚠️ NO LIVE ARGO CD INSTANCE EXISTS ON THE ESTATE YET (2026-09-24) — this family is built ahead
 *   of the Talos-on-PVE cluster it targets, per Tim's "get the providers ready even if we don't
 *   use it yet but we know we will." Nothing here has been exercised against a real server; every
 *   test in this family runs against `fake-argocd.ts`.
 */
import type { Config } from '@distilled.cloud/argocd/Credentials';
import { Credentials, CredentialsFromEnv, fromToken } from '@distilled.cloud/argocd/Credentials';

/** Re-exported so a consumer never has to reach into `@distilled.cloud/argocd` by hand. */
export { Credentials, CredentialsFromEnv, fromToken };
export type { Config as ArgocdCredentialsConfig };

/** `ArgocdCredentials.fromEnv()` — the layer every `argocdProviders()` stack uses by default. */
export const fromEnv = () => CredentialsFromEnv;
