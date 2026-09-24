# Discord — `@homeflare/alchemy/discord`

Declares Discord application commands (global and guild-scoped) against
`@distilled.cloud/discord@1.0.0-rc.12`. Built 2026-09-24, walked against the live target,
`hf-discord-halibut.service` on CT100 — read-only; nothing in this walk deployed anything or
touched a real token. See [`upstream-conformance.md`](./upstream-conformance.md#discord) for the
rule-by-rule accounting.

## Resource set, and why it stops there

Two resources: `Discord.ApplicationCommand` (global) and `Discord.GuildApplicationCommand`
(guild-scoped). The SDK's `discord.ts` service also generates guild role, guild channel and
webhook operations (`createGuildRole`, `createGuildChannel`, `createWebhook`, …), but
`hf-discord-halibut.service` — the only live Discord workload the estate runs — touches none of
them: it registers slash commands and nothing else (measured on CT100, see below). "Start with
what Halibut actually uses" (the task this shipped under) means roles, channels and webhooks stay
unbuilt until a real stack needs to declare one; the engine in `resource.ts` is generic enough
that adding `Discord.GuildRole` later is a new spec file, not a new engine.

## Halibut, measured on CT100 (read-only, 2026-09-24)

- **Application/bot**: `hf-discord-halibut.service`, `/opt/homeflare/discord-bot/halibut`,
  Sapphire on discord.js. Token in `/opt/homeflare/env/discord-halibut.env`
  (`DISCORD_TOKEN`, `0640 root:homeflare`), loaded by systemd's `EnvironmentFile=`. Never read by
  this package.
- **Guild(s)**: `DISCORD_GUILD_ID`, a CSV of two snowflakes (commented `HomeFlare,schenanigans`
  in `register.ts`) — guild-scoped registration only; `DISCORD_GUILD_ID` is always set in
  production, so `guildIdsForRegister()` never falls through to global.
- **Commands** (`CURRENT_SLASH_NAMES`, `src/discord/register.ts`): `ping`, `whoami`, `session`,
  `status`, `llmstats`, `run`, `sch`, `pr`, `voice` — nine guild-scoped slash commands.
- **Registration timing**: `applySapphireGuildRegister()` runs once **before login**, setting
  Sapphire's `RegisterBehavior.BulkOverwrite` and its default guild ids. On every connect,
  Sapphire then `application.commands.set()`s the exact `CURRENT_SLASH_NAMES` set — a PUT that
  wipes anything else registered on those guilds ("Stale guild cmds … have no handler → Discord
  'interaction failed'", the file's own comment, measured 2026-09-04).
- **Webhooks, roles, channels**: none found. `grep -rli webhook` over `dist/` matched nothing;
  the only role/channel-shaped env var is an unrelated `DISCORD_FORUM_TAG_MAP`.

## 🔴 Ownership conflict: do not deploy `GuildApplicationCommand` against Halibut's guilds yet

Halibut's `BulkOverwrite` on every restart and this resource's `reconcile` (an upsert on every
apply where `matches` fails) are two independent writers converging the same object on two
different schedules. Declaring `Discord.GuildApplicationCommand` for `ping`/`whoami`/… on
Halibut's guilds today would not replace Halibut's registration — it would race it. Whichever ran
last after each of the bot's restarts and each `alchemy deploy` would win until the other ran
again, and `alchemy plan` would report drift the bot itself caused.

**The handover, when someone runs it (none of this is done by this change):**

1. Freeze `CURRENT_SLASH_NAMES` — it is already the single source of truth for the set.
2. Declare each command as a `guildApplicationCommand(...)` (the `adopt(true)` constructor) with
   props matching what is live exactly. A verified apply should be a no-op — `hf-adopt-verify`
   proves that without writing (H6).
3. **In the same deploy window**, remove the `applySapphireGuildRegister()` call from Halibut's
   `src/discord/register.ts` and redeploy the bot. Step 2 without step 3 leaves both writers
   active; step 3 without step 2 leaves the commands with no owner at all until the next deploy.

Steps 1–3 are bot-runtime changes and out of scope for this family, which is declarative only.

## Credentials

`DISCORD_BOT_TOKEN` (falling back to `DISCORD_TOKEN`), read **at call time**, never a prop —
`@distilled.cloud/discord/Credentials`' own `CredentialsFromEnv`, re-exported from
`credentials.ts` rather than re-implemented. No OpenBao mint yet (H8's target,
`Alchemy.Stack({ secrets })`, is unreleased); today a deploy process exports the variable itself.

## Adopt is `adopt(true)`, not silent

Unlike NetBox (H1's documented gap), this family follows upstream's `Snippet.ts` reference for a
marker-less API exactly: a cold `read` (no persisted `output`) that finds a live command by name
returns `Unowned(attrs)`, so a first deploy against an existing command fails
`OwnedBySomeoneElse` **unless** `adopt(true)` is set. Both convenience constructors
(`applicationCommand`, `guildApplicationCommand`) pipe `adopt(true)` on by default (H5), matching
`cloudflare/website.ts`'s `astroWebsite`/`viteWebsite`.

## Reconcile is one upsert call

Discord's own docs for both Create Global/Guild Application Command say a command with the same
name (and type) as an existing one overwrites it — the create endpoint is a true upsert, the same
shape `Snippet.ts`'s `putSnippet` uses. `reconcile` therefore has no separate PATCH path: it reads
the live command, and calls `create` only when `commandMatches` says the declaration and the live
object disagree. ⚠️ REASONED NOT MEASURED — this task had no token and made no real Discord API
call; it is documented Discord behaviour, unchanged across API v10, not something exercised here.

## Rate limits: the SDK's default bound, not a house retry

Every generated operation threads a `Retry` context tag (`retry: Retry.Retry` in
`protocol.ts`/`api.ts`). With no policy installed, `@distilled.cloud/core`'s `makeDefault` applies:
capped exponential backoff (250ms × 2, capped at 5s), **`Schedule.recurs(8)`** (bounded — S26 asks
for 8–10 attempts), and a `429`'s `Retry-After` honored with precedence, itself capped at 60s
(`DEFAULT_SERVER_RETRY_HINT_CAP_MS`). This family adds nothing on top — no `Discord.Retry.policy`
call anywhere in `resource.ts` — because adding one could only make it either redundant with, or
looser than, the bound the SDK already guarantees. `retry.test.ts` proves both directions against
the fake: a rate-limited call is retried and eventually succeeds, AND a call rate-limited forever
still stops — `fake.seen.length` is asserted `<= 9` (1 attempt + `Schedule.recurs(8)`), not just
"eventually rejects", so the bound itself is what the test checks.

## SDK gaps

- 🔴 **MEASURED: every generated operation's typed error union is narrower than the protocol's own
  `HTTP_STATUS_MAP`.** `tsc` is what surfaced this — see `guild-application-command.test.ts`'s
  401 test and its own comment. `DiscordOpError` (every operation's declared error type) resolves
  to `DefaultErrors | ConfigError | HttpClientError`, and core's `DefaultErrors` is built only from
  `DEFAULT_ERROR_STATUSES` — 401, 429, 500, 502, 503, 504. `Forbidden` (403), `NotFound` (404),
  `BadRequest` (400) and `Conflict` (409) are in `HTTP_STATUS_MAP` and so ARE constructed by the
  protocol at runtime on those statuses, but they are absent from the exported error TYPE, so
  `catchTag('Forbidden', …)` does not type-check anywhere in this family without an unsafe cast.
  Nothing in `resource.ts` currently needs to catch any of those four (locate is list-based and
  never 404s, the same reasoning `netbox/prefix.ts` documents), but a future resource that does —
  or `destroy`'s own TOCTOU race, where the command could vanish between `fetchByName` and the
  delete call and legitimately 404 — cannot `catchTag('NotFound', …)` today. That gap is real and
  unhandled in `resource.ts#destroy`, documented rather than papered over with a cast.
- **`options` is passed through opaquely**, not re-modeled. The generated option union is ~40
  nested schema types; `command-form.ts` types it as `readonly Record<string, unknown>[]` and
  neither validates nor transforms it. A caller supplies Discord's own wire shape.
- **No vendor constraint table**, unlike NetBox/Paperless. Distilled's schema carries Discord's
  field limits (name length, description length, max 25 options, …) but this change did not walk
  `vendor-schema` for Discord; a bad declaration fails at the API call, not at plan time.
- **`default_member_permissions` type asymmetry**: the generated request types show
  `number | null`, the response shows `string | null`. Discord's real wire contract is a
  stringified bitfield on both sides; `command-form.ts` types the prop as `string` (matching the
  response and Discord's docs) and casts through `unknown` at the SDK call boundary, the same
  pattern `netbox/prefix.ts` uses for its own generated-type mismatches.
- **Global command propagation** (up to an hour, Discord's own docs) is not polled — S26 bounds
  waits at ~60s, which cannot cover an hour. A `diff` run inside that window may report transient
  drift. Documented in `application-command.ts`, not solved.
- **No live lifecycle test** (H12): tests run against `fake-discord.ts`, a loopback fake, not a
  real Discord application. This task could not hold a token to run one even if the house allowed
  agent-run live writes, which it currently does not.
