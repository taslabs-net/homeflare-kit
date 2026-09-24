/**
 * OPNsense credentials — a key/secret pair REFERENCE, resolved lazily (S24), never a prop.
 *
 * ⛔ NO KEY OR SECRET IS EVER A PROP OR AN ATTRIBUTE. Alchemy persists Attributes unencrypted
 *   (`State/StateEncoding.ts@v2.0.0-beta.79#encodeState`), so nothing a stack file holds may be a
 *   credential. `@distilled.cloud/opnsense/Credentials` already ships exactly the shape S24 asks
 *   for: `Credentials` is a lazy `Context.Service<Credentials, Effect.Effect<Config>>`, resolved
 *   on the calling fiber inside each operation (`OpnsenseProtocol`'s `encode`), never at layer
 *   build. This file re-exports it rather than re-implementing it — the same choice
 *   `../discord/credentials.ts` made for its own SDK's `CredentialsFromEnv`.
 *
 * ★ `CredentialsFromEnv` READS `OPNSENSE_URL` / `OPNSENSE_API_KEY` / `OPNSENSE_API_SECRET` via
 *   Effect's `Config` (the SDK's own `credentials.ts` — no vendor-standard env var names exist
 *   for OPNsense's API, unlike Forgejo's `FORGEJO_URL`). The resource never sees the values,
 *   only the deploy process's environment does, and the secret is `Redacted` the moment it is
 *   read — exactly the "reference, never a value" shape S25 asks for.
 *
 * ⚠️ NO OpenBao MINT YET, THE SAME GAP `../discord/credentials.ts` DOCUMENTS. H8's target
 *   (`Alchemy.Stack({ secrets })`) is unreleased (PR 1728, `main` only). Until the estate is on a
 *   release that carries it, the deploy process's own environment is the credential seam — a
 *   human or CI job exports the three `OPNSENSE_*` variables from wherever it mints them. This
 *   package never mints, reads or logs the key/secret itself; it only names the variables.
 */
import type { Config } from '@distilled.cloud/opnsense/Credentials';
import {
  Credentials,
  CredentialsFromEnv,
  credentials,
} from '@distilled.cloud/opnsense/Credentials';

/** Re-exported so a consumer never has to reach into `@distilled.cloud/opnsense` by hand. */
export { Credentials, CredentialsFromEnv, credentials };
export type { Config as OpnsenseCredentialsConfig };

/**
 * `OpnsenseCredentials.fromEnv()` — the layer `opnsenseHandlers` (resource.ts) provides by
 * default. A thin, named alias over `CredentialsFromEnv` so a stack's import reads `Opnsense.*`
 * throughout, the way `../discord/credentials.ts`'s `fromEnv()` keeps `Discord.*` names at the
 * front door.
 */
export const fromEnv = () => CredentialsFromEnv;
