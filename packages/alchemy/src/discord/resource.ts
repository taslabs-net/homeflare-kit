/**
 * One shape for every Discord application-command object — global and guild-scoped alike.
 *
 * ⛔ THE ALTERNATIVE IS COPYING THE SAME READ/RECONCILE/DELETE PER RESOURCE. `application-command.ts`
 *   and `guild-application-command.ts` differ only in which distilled operations they call and
 *   whether `guild_id` is part of identity — so the read/diff/reconcile/delete flow lives here
 *   once, mirroring `../netbox/resource.ts`'s `netboxOperations`/`netboxHandlers` split.
 *
 * ★ UNLIKE NETBOX, THIS FOLLOWS UPSTREAM'S `Snippet.ts` READ/RECONCILE SHAPE EXACTLY (S7–S9), NOT
 *   netbox's "adopt silently" gap (H1). Discord commands carry no ownership marker of any kind —
 *   no tags, no metadata field a bot could stamp — so this is precisely the "marker-less API" S8
 *   describes, and `Snippet.ts@v2.0.0-beta.79#read` is the cited reference: an existing match is
 *   `Unowned(attrs)` on a cold read (no persisted `output`), and plain attributes on a warm read
 *   (persisted `output` says we already made or adopted this exact command). `adopt(true)` (H5),
 *   piped onto each resource by the constructors in the two resource files, is what turns that
 *   `Unowned` into a silent one-time takeover instead of an `OwnedBySomeoneElse` refusal.
 *
 * ★ RECONCILE IS ONE UPSERT CALL, LIKE `Snippet.ts`'s `putSnippet`. Discord's own docs for both
 *   Create Global/Guild Application Command say a command with the same name (and type) as an
 *   existing one OVERWRITES it — the create endpoint is a true upsert, not a create-only call that
 *   409s on a name collision. ⚠️ REASONED NOT MEASURED (no token available to this task; see
 *   `docs/discord.md`): this is Discord's documented behaviour, unchanged across API v10, but it
 *   has not been exercised against the real API by this change. One call therefore converges
 *   greenfield create, routine update AND adoption alike — there is no separate PATCH path, and
 *   S10's "zero write calls when there is no drift" is still honoured because `reconcile` skips
 *   the call entirely when `spec.matches` already holds.
 *
 * ⚠️ `list` ANSWERS EMPTY, ON PURPOSE, EVEN THOUGH THE DISTILLED LIST OPERATIONS EXIST. A bot's
 *   guild command set is exactly what `hf-discord-halibut.service` bulk-overwrites at every
 *   restart (see `docs/discord.md#halibut`); a `nuke` that enumerated and swept every live command
 *   would fight that ownership, not just this resource's own declarations. Adoption stays
 *   explicit, the same reasoning netbox's `list` gives for a shared instance predating the kit.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { DiscordOpContext } from '@distilled.cloud/discord/Protocol';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { CredentialsFromEnv } from './credentials.ts';

/**
 * What every stack must still provide after `discordHandlers` bakes in `CredentialsFromEnv`
 * (below): the transport. `DiscordOpContext` is `Credentials | HttpClient.HttpClient`, so once
 * `Credentials` is supplied, `HttpClient.HttpClient` is what remains — mirroring
 * `../netbox/resource.ts#NetboxRequirements`.
 */
export type DiscordRequirements = HttpClient.HttpClient;

/** Every Discord command resource's identity key, regardless of scope. */
export interface DiscordCommandIdentity {
  readonly name: string;
}

/**
 * One Discord command object's distilled calls. `Live` is whatever the SDK decodes
 * (`ApplicationCommandResponse`); `E` is left to each resource file to declare, so a call site's
 * precise error union (in practice always `DiscordOpError` — see `protocol.ts` — because every
 * generated Discord operation shares one error channel) flows straight through.
 */
export type DiscordSpec<
  Props extends DiscordCommandIdentity,
  Live,
  Attributes extends object,
  E,
> = {
  /** Locate the live command by its declared name within this spec's scope (app, or app+guild). */
  readonly fetchByName: (props: Props) => Effect.Effect<Live | undefined, E, DiscordOpContext>;
  readonly attributes: (live: Live) => Attributes;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  readonly upsertBody: (props: Props) => Record<string, unknown>;
  /** POST create-or-overwrite — see the upsert note above. */
  readonly upsert: (
    props: Props,
    body: Record<string, unknown>,
  ) => Effect.Effect<Live, E, DiscordOpContext>;
  readonly destroy: (props: Props, live: Live) => Effect.Effect<unknown, E, DiscordOpContext>;
  /** For error messages and test descriptions. */
  readonly describe: (props: Props) => string;
};

export const discordOperations = <
  Props extends DiscordCommandIdentity,
  Live,
  Attributes extends object,
  E,
>(
  spec: DiscordSpec<Props, Live, Attributes, E>,
) => ({
  read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
    Effect.gen(function* () {
      const live = yield* spec.fetchByName(olds);
      if (live === undefined) return undefined;
      const attrs = spec.attributes(live);
      // Warm read: a prior apply already created or adopted this exact command — ours.
      if (output !== undefined) return attrs;
      // Cold read (fresh store, or state lost): no ownership marker exists on this vendor,
      // so any match is `Unowned` until `adopt(true)` (or `--adopt`) says otherwise (S7, S8).
      return Unowned(attrs);
    }),

  diff: (news: Input<Props>, output: Attributes | undefined) =>
    Effect.gen(function* () {
      if (output === undefined || !isResolved(news)) return undefined;
      const live = yield* spec.fetchByName(news);
      if (live === undefined) return { action: 'update' } as const;
      return spec.matches(spec.attributes(live), news)
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: (news: Props) =>
    Effect.gen(function* () {
      const before = yield* spec.fetchByName(news);
      if (before !== undefined && spec.matches(spec.attributes(before), news)) {
        // Already exactly what is declared — S10: no write.
        return spec.attributes(before);
      }
      const body = spec.upsertBody(news);
      const after = yield* spec.upsert(news, body);
      return spec.attributes(after);
    }),

  // ⚠️ GAP, NOT SOLVED: a TOCTOU race between the fetch above and the delete call below could
  //   see Discord answer 404 on a command that vanished between the two — S11 asks that race to
  //   be treated as success, `catchTag('NotFound', …)`. The SDK's declared error type for every
  //   operation does not include `NotFound` (see `docs/discord.md#sdk-gaps` — measured, not
  //   assumed), so there is no typed tag to catch here without an unsafe cast. Left unhandled.
  destroy: (olds: Props) =>
    Effect.gen(function* () {
      const live = yield* spec.fetchByName(olds);
      if (live === undefined) return;
      yield* spec.destroy(olds, live);
    }),
});

/**
 * The four provider handlers for a spec'd Discord command, wired once.
 *
 * ★ CREDENTIALS ARE PROVIDED HERE, ONCE. `CredentialsFromEnv` resolves `DISCORD_BOT_TOKEN` /
 *   `DISCORD_TOKEN` on the calling fiber per request (credentials.ts), so this closure keeps that
 *   laziness — nothing is captured at module load.
 */
export const discordHandlers = <
  Props extends DiscordCommandIdentity,
  Live,
  Attributes extends object,
  E,
>(
  spec: DiscordSpec<Props, Live, Attributes, E>,
) => {
  const ops = discordOperations(spec);
  const withCredentials = <A>(effect: Effect.Effect<A, E, DiscordOpContext>) =>
    Effect.provide(effect, CredentialsFromEnv);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
      withCredentials(ops.read({ olds, output })),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      withCredentials(ops.diff(news, output)),
    reconcile: ({ news }: { news: Props }) => withCredentials(ops.reconcile(news)),
    delete: ({ olds }: { olds: Props }) => withCredentials(ops.destroy(olds)),
  };
};
