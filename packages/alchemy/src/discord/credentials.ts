/**
 * Discord credentials — a bot token REFERENCE, resolved lazily (S24), never a prop.
 *
 * ⛔ NO TOKEN IS EVER A PROP OR AN ATTRIBUTE. Alchemy persists Attributes unencrypted
 *   (State/StateEncoding.ts@v2.0.0-beta.79#encodeState), so nothing a stack file holds may be a
 *   credential. `@distilled.cloud/discord/Credentials` already ships exactly the shape S24 asks
 *   for: `Credentials` is a lazy `Context.Service<Credentials, Effect.Effect<Config>>`, resolved
 *   on the calling fiber inside each operation (`DiscordProtocol`'s `credentials:` field), never
 *   at layer build. This file re-exports it rather than re-implementing it — the same choice
 *   `../netbox/resource.ts` made for `CredentialsFromEnv` — and adds only the house-specific
 *   naming and doc trail.
 *
 * ★ `CredentialsFromEnv` reads `DISCORD_BOT_TOKEN` (falling back to `DISCORD_TOKEN`) via Effect's
 *   `Config`, which is exactly the "reference" shape S25 asks for: the resource never sees the
 *   value, only the environment variable NAME is anywhere near a stack file, and the value itself
 *   is wrapped in `Redacted` the moment it is read.
 *
 * ⚠️ NO OpenBao MINT YET. H8's target (`Alchemy.Stack({ secrets })`) is unreleased (PR 1728, still
 *   on `main` only). Until the estate is on a release that carries it, the deploy process's own
 *   environment is the credential seam — a human or CI job exports `DISCORD_BOT_TOKEN` from
 *   wherever it mints it (on CT100 today: `/opt/homeflare/env/discord-halibut.env`, read by
 *   systemd's `EnvironmentFile=`, never by this package). This package never reads that file.
 */
import type { Config } from '@distilled.cloud/discord/Credentials';
import { Credentials, CredentialsFromEnv, credentials } from '@distilled.cloud/discord/Credentials';

/** Re-exported so a consumer never has to reach into `@distilled.cloud/discord` by hand. */
export { Credentials, CredentialsFromEnv, credentials };
export type { Config as DiscordCredentialsConfig };

/**
 * `DiscordCredentials.fromEnv()` — the layer every `discordProviders()` stack uses by default.
 * A thin, named alias over `CredentialsFromEnv` so a stack's import reads `Discord.*`
 * throughout, the way `../netbox/index.ts`'s barrel keeps `Netbox*` names at the front door.
 */
export const fromEnv = () => CredentialsFromEnv;
