/**
 * `Discord.ApplicationCommand`'s `spec` (global scope) against a fake Discord. Shares its engine
 * (`discordOperations`) and its comparison functions (`command-form.ts`) with
 * `guild-application-command.test.ts`, which covers those in depth — this file proves only what
 * differs for global commands: the URL shape (no `guild_id`), and that `spec.attributes` never
 * invents one.
 */
import { describe, expect, test } from 'bun:test';
import type * as command from '@distilled.cloud/discord/discord';
import * as Effect from 'effect/Effect';
import { spec } from './application-command.ts';
import type { ApplicationCommandProps } from './application-command.ts';
import { fakeDiscord, fakeDiscordLayer, fakeFailure } from './fake-discord.ts';
import { discordOperations } from './resource.ts';

const APP = '111111111111111111';
const CMD_PATH = `/applications/${APP}/commands`;
const PROPS: ApplicationCommandProps = {
  applicationId: APP,
  description: 'ping the bot',
  name: 'ping',
};

/** Loosely typed on purpose — a fixture, cast to the real response shape at the boundary. */
const liveCommand = (overrides: Record<string, unknown> = {}) =>
  ({
    application_id: APP,
    default_member_permissions: null,
    description: 'ping the bot',
    id: '999',
    name: 'ping',
    nsfw: false,
    type: 1,
    version: '1',
    ...overrides,
  }) as unknown as command.ApplicationCommandResponse;

describe('Discord.ApplicationCommand spec.fetchByName', () => {
  test('lists the GLOBAL path, with no guild segment', async () => {
    const fake = fakeDiscord((method, url) =>
      method === 'GET' && url.pathname === CMD_PATH
        ? Response.json([liveCommand()])
        : fakeFailure(400, 0, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchByName(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(live?.id).toBe('999');
    expect(fake.seen[0]?.path).toBe(CMD_PATH);
  });
});

describe('Discord.ApplicationCommand spec.attributes', () => {
  test('has no guildId field at all — a global command is scopeless', () => {
    const attrs = spec.attributes(liveCommand());
    expect('guildId' in attrs).toBe(false);
    expect(attrs.applicationId).toBe(APP);
  });
});

describe('discordOperations(spec).reconcile', () => {
  test('creates against the global path when absent', async () => {
    const fake = fakeDiscord((method, url) => {
      if (method === 'GET' && url.pathname === CMD_PATH) return Response.json([]);
      if (method === 'POST' && url.pathname === CMD_PATH) return Response.json(liveCommand());
      return fakeFailure(400, 0, 'unexpected request');
    });
    const ops = discordOperations(spec);
    const attrs = await Effect.runPromise(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(attrs.commandId).toBe('999');
    expect(fake.seen.some((s) => s.method === 'POST' && s.path === CMD_PATH)).toBe(true);
  });

  test('a matching live command makes zero write calls (S10)', async () => {
    const fake = fakeDiscord((method, url) =>
      method === 'GET' && url.pathname === CMD_PATH
        ? Response.json([liveCommand()])
        : fakeFailure(500, 0, 'unexpected write'),
    );
    const ops = discordOperations(spec);
    await Effect.runPromise(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]?.method).toBe('GET');
  });
});

describe('discordOperations(spec).destroy', () => {
  test('deletes against the global path by command id', async () => {
    const fake = fakeDiscord((method, url) => {
      if (method === 'GET' && url.pathname === CMD_PATH) return Response.json([liveCommand()]);
      if (method === 'DELETE' && url.pathname === `${CMD_PATH}/999`)
        return new Response(null, { status: 204 });
      return fakeFailure(400, 0, 'unexpected request');
    });
    const ops = discordOperations(spec);
    await Effect.runPromise(ops.destroy(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))));
    expect(fake.seen.some((s) => s.method === 'DELETE')).toBe(true);
  });
});
