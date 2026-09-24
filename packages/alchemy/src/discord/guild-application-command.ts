/**
 * `Discord.GuildApplicationCommand` — one guild-scoped slash/user/message command.
 *
 * 🔴 THIS IS WHAT `hf-discord-halibut.service` OWNS TODAY, AND DECLARING IT AGAINST HALIBUT'S OWN
 *   GUILDS WOULD FIGHT THE BOT, NOT REPLACE IT. Halibut calls `applySapphireGuildRegister()`
 *   before every login (`src/discord/register.ts` on CT100, `RegisterBehavior.BulkOverwrite`),
 *   which PUTs its exact `CURRENT_SLASH_NAMES` set on every restart. Deploying this resource
 *   against the same `(applicationId, guildId)` the bot manages means two owners converging the
 *   same object on two different schedules — the bot's restart would silently undo whatever this
 *   resource last wrote, and the next `alchemy plan` would then report drift the bot just caused,
 *   forever. See `docs/discord.md#halibut` for the measured command list, guild id source, and the
 *   handover sequence (freeze the list, adopt each command with `adopt(true)` for a verified
 *   no-op, THEN remove `applySapphireGuildRegister()` from the bot in the same deploy window —
 *   bot-runtime code, explicitly out of scope for this family).
 *
 * ★ Until that handover happens, this resource is for guilds/applications Halibut does not touch.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as command from '@distilled.cloud/discord/discord';
import type { DiscordOpError } from '@distilled.cloud/discord/Protocol';
import * as Effect from 'effect/Effect';
import {
  type CommandFields,
  type CommandFieldsAttributes,
  commandBody,
  commandFieldsOf,
  commandMatches,
} from './command-form.ts';
import type { DiscordRequirements, DiscordSpec } from './resource.ts';
import { discordHandlers } from './resource.ts';

export interface GuildApplicationCommandProps extends CommandFields {
  /** The Discord application (bot) this command belongs to — a public snowflake, not a secret. */
  applicationId: string;
  /** The guild (server) this command is scoped to — a public snowflake. */
  guildId: string;
}

export interface GuildApplicationCommandAttributes extends CommandFieldsAttributes {
  commandId: string;
  applicationId: string;
  guildId: string;
  version: string;
}

export interface DiscordGuildApplicationCommand extends Resource<
  'Discord.GuildApplicationCommand',
  GuildApplicationCommandProps,
  GuildApplicationCommandAttributes,
  never,
  DiscordRequirements
> {}

export const DiscordGuildApplicationCommand = Resource<DiscordGuildApplicationCommand>(
  'Discord.GuildApplicationCommand',
  { defaultRemovalPolicy: 'retain' },
);

export const isDiscordGuildApplicationCommand = (
  value: unknown,
): value is DiscordGuildApplicationCommand =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Discord.GuildApplicationCommand';

const attributesOf = (
  live: command.ApplicationCommandResponse,
): GuildApplicationCommandAttributes => ({
  applicationId: live.application_id,
  commandId: live.id,
  // ⚠️ `guild_id` is present on every row a GUILD list call returns (Discord scopes the list by
  //   guild), so this cast documents that guarantee rather than re-deriving it from `props`.
  guildId: live.guild_id as string,
  version: live.version,
  ...commandFieldsOf(live),
});

/** Exported for direct testing against `fake-discord.ts`. */
export const spec: DiscordSpec<
  GuildApplicationCommandProps,
  command.ApplicationCommandResponse,
  GuildApplicationCommandAttributes,
  DiscordOpError
> = {
  attributes: attributesOf,
  describe: (props) =>
    `applications/${props.applicationId}/guilds/${props.guildId}/commands ${props.name}`,
  destroy: (props, live) =>
    command.deleteGuildApplicationCommand({
      application_id: props.applicationId,
      command_id: live.id,
      guild_id: props.guildId,
    }),
  fetchByName: (props) =>
    command
      .listGuildApplicationCommands({
        application_id: props.applicationId,
        guild_id: props.guildId,
      })
      .pipe(Effect.map((rows) => rows.find((row) => row.name === props.name))),
  matches: commandMatches,
  upsert: (props, body) =>
    command.createGuildApplicationCommand({
      application_id: props.applicationId,
      guild_id: props.guildId,
      ...(body as Omit<
        command.CreateGuildApplicationCommandRequest,
        'application_id' | 'guild_id'
      >),
    }),
  upsertBody: commandBody,
};

export const handlers = discordHandlers(spec);

export const DiscordGuildApplicationCommandProvider = () =>
  Provider.effect(
    DiscordGuildApplicationCommand,
    Effect.succeed(DiscordGuildApplicationCommand.Provider.of(handlers)),
  );

/**
 * `guildApplicationCommand('ping', { applicationId, guildId, name: 'ping' })` — `adopt(true)`
 *   piped on by default (H5). See the file header before pointing this at a guild Halibut manages.
 */
export const guildApplicationCommand = (id: string, props: GuildApplicationCommandProps) =>
  DiscordGuildApplicationCommand(id, props).pipe(adopt(true));
