/**
 * `Discord.ApplicationCommand` — one GLOBAL slash/user/message command on a Discord application.
 *
 * ⛔ NOT WHAT `hf-discord-halibut.service` USES TODAY. Halibut registers guild-scoped commands
 *   only (`DISCORD_GUILD_ID` is always set in production — see `docs/discord.md#halibut`), so this
 *   resource has no live object to adopt yet. It exists because the distilled SDK, and Discord's
 *   own API, model global and guild commands as siblings (same shape, different scope), and a
 *   future bot or a future Halibut command that goes global needs it without a second family.
 *
 * ⚠️ GLOBAL COMMAND CHANGES TAKE UP TO AN HOUR TO PROPAGATE (Discord's own docs). A `diff` that
 *   ran right after a write could see stale results; this resource does not poll for propagation
 *   (S26 bounds waits at ~60s, an hour is not boundable), so a plan run inside that window may
 *   report drift that will resolve itself. Documented, not solved — see `docs/discord.md`.
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

export interface ApplicationCommandProps extends CommandFields {
  /** The Discord application (bot) this command belongs to — a public snowflake, not a secret. */
  applicationId: string;
}

export interface ApplicationCommandAttributes extends CommandFieldsAttributes {
  commandId: string;
  applicationId: string;
  version: string;
}

export interface DiscordApplicationCommand extends Resource<
  'Discord.ApplicationCommand',
  ApplicationCommandProps,
  ApplicationCommandAttributes,
  never,
  DiscordRequirements
> {}

export const DiscordApplicationCommand = Resource<DiscordApplicationCommand>(
  'Discord.ApplicationCommand',
  {
    // Commands are the thing a user reads; nothing here can be edited into another object.
    defaultRemovalPolicy: 'retain',
  },
);

export const isDiscordApplicationCommand = (value: unknown): value is DiscordApplicationCommand =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Discord.ApplicationCommand';

const attributesOf = (live: command.ApplicationCommandResponse): ApplicationCommandAttributes => ({
  applicationId: live.application_id,
  commandId: live.id,
  version: live.version,
  ...commandFieldsOf(live),
});

/** Exported for direct testing against `fake-discord.ts` — the same seam `../netbox/prefix.ts` uses. */
export const spec: DiscordSpec<
  ApplicationCommandProps,
  command.ApplicationCommandResponse,
  ApplicationCommandAttributes,
  DiscordOpError
> = {
  attributes: attributesOf,
  describe: (props) => `applications/${props.applicationId}/commands ${props.name}`,
  destroy: (props, live) =>
    command.deleteApplicationCommand({ application_id: props.applicationId, command_id: live.id }),
  fetchByName: (props) =>
    command
      .listApplicationCommands({ application_id: props.applicationId })
      .pipe(Effect.map((rows) => rows.find((row) => row.name === props.name))),
  matches: commandMatches,
  upsert: (props, body) =>
    command.createApplicationCommand({
      application_id: props.applicationId,
      ...(body as Omit<command.CreateApplicationCommandRequest, 'application_id'>),
    }),
  upsertBody: commandBody,
};

export const handlers = discordHandlers(spec);

export const DiscordApplicationCommandProvider = () =>
  Provider.effect(
    DiscordApplicationCommand,
    Effect.succeed(DiscordApplicationCommand.Provider.of(handlers)),
  );

/**
 * `applicationCommand('help', { applicationId, name: 'help', description: '…' })` — `adopt(true)`
 *   piped on by default (H5), so a first deploy against a command that already exists silently
 *   takes it over instead of failing `OwnedBySomeoneElse`. Mirrors `cloudflare/website.ts`'s
 *   `astroWebsite`/`viteWebsite` convenience constructors.
 */
export const applicationCommand = (id: string, props: ApplicationCommandProps) =>
  DiscordApplicationCommand(id, props).pipe(adopt(true));
