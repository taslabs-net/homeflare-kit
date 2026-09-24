---
'@homeflare/alchemy': minor
---

New `@homeflare/alchemy/discord` subpath, built directly on `@distilled.cloud/discord`
(1.0.0-rc.12) — no hand-rolled client ever existed for this vendor to retire.
`Discord.ApplicationCommand` (global) and `Discord.GuildApplicationCommand` (guild-scoped)
declare a slash/user/message command; `reconcile` is one upsert call, matching Discord's own
create-endpoint semantics (a command with the same name overwrites the old one), the same shape
`Cloudflare.Snippets.Snippet`'s `putSnippet` uses upstream. `read` follows that same upstream
reference for a marker-less API exactly: a cold match is `Unowned`, never a silent adopt, and
both convenience constructors (`applicationCommand`, `guildApplicationCommand`) pipe `adopt(true)`
by default. Rate limits are handled entirely by the SDK's own bounded default retry policy
(`Schedule.recurs(8)`, honoring a `429`'s `Retry-After`); this family adds no retry logic of its
own. Credentials are `DISCORD_BOT_TOKEN`/`DISCORD_TOKEN`, read at call time through the SDK's own
`CredentialsFromEnv`, never a prop.

Walked read-only against the live target, `hf-discord-halibut.service` on CT100: the bot
self-registers nine guild-scoped commands at every startup (Sapphire's `BulkOverwrite`), so
`docs/discord.md` documents the ownership conflict and the handover sequence rather than
declaring `Discord.GuildApplicationCommand` against Halibut's own guilds — that would fight the
bot's own registration, not replace it. Guild roles, channels and webhooks are not built: Halibut
uses none of them (measured on CT100), and the engine in `resource.ts` generalizes cleanly to a
future spec file if a stack ever needs one.

SDK gaps recorded in `docs/discord.md`: every generated operation's typed error union is narrower
than the protocol's own status map (`Forbidden`/`NotFound`/`BadRequest`/`Conflict` are built at
runtime but not in the exported type — measured via `tsc`, not assumed); `options` is passed
through opaquely rather than re-modeled from the ~40-type generated union; there is no vendor
constraint table (unlike NetBox/Paperless); global command propagation (up to an hour, Discord's
own docs) is not polled.
