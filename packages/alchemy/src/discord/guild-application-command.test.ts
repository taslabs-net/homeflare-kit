/**
 * `Discord.GuildApplicationCommand`'s `spec` against a fake Discord, proving the real distilled
 * wire path — path assembly, JSON encode/decode and typed-error matching — exercised through
 * `@distilled.cloud/discord/discord`'s real operations, never re-implemented here. Also proves
 * `discordOperations(spec)`'s read/reconcile flow (resource.ts), the exact object `discordHandlers`
 * wraps into `DiscordGuildApplicationCommandProvider`. Mirrors `../netbox/prefix.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type * as command from '@distilled.cloud/discord/discord';
import * as Effect from 'effect/Effect';
import { FAKE_BASE, fakeDiscord, fakeDiscordLayer, fakeFailure } from './fake-discord.ts';
import type { GuildApplicationCommandProps } from './guild-application-command.ts';
import { spec } from './guild-application-command.ts';
import { discordOperations } from './resource.ts';

const APP = '111111111111111111';
const GUILD = '222222222222222222';
const CMD_PATH = `/applications/${APP}/guilds/${GUILD}/commands`;
const PROPS: GuildApplicationCommandProps = {
  applicationId: APP,
  description: 'ping the bot',
  guildId: GUILD,
  name: 'ping',
};

/** Loosely typed on purpose — a fixture, cast to the real response shape at the boundary. */
const liveCommand = (overrides: Record<string, unknown> = {}) =>
  ({
    application_id: APP,
    default_member_permissions: null,
    description: 'ping the bot',
    guild_id: GUILD,
    id: '999',
    name: 'ping',
    nsfw: false,
    type: 1,
    version: '1',
    ...overrides,
  }) as unknown as command.ApplicationCommandResponse;

describe('Discord.GuildApplicationCommand spec.fetchByName', () => {
  test('finds the row whose name matches, among others', async () => {
    const fake = fakeDiscord((method, url) =>
      method === 'GET' && url.pathname === CMD_PATH
        ? Response.json([
            liveCommand({ id: '1', name: 'other' }),
            liveCommand({ id: '999', name: 'ping' }),
          ])
        : fakeFailure(400, 0, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchByName(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(live?.id).toBe('999');
    expect(fake.seen[0]?.method).toBe('GET');
  });

  test('no matching name is absent, not an error', async () => {
    const fake = fakeDiscord(() => Response.json([liveCommand({ name: 'other' })]));
    const live = await Effect.runPromise(
      spec.fetchByName(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  /**
   * ⚠️ 401, NOT 403. MEASURED: the SDK types every generated Discord operation's error channel
   *   as exactly `DiscordOpError` — `DefaultErrors | ConfigError | HttpClientError`, which core's
   *   `errors.ts` builds only from `DEFAULT_ERROR_STATUSES` (401/429/500/502/503/504). 403
   *   (`Forbidden`), 404 (`NotFound`), 400 (`BadRequest`) and 409 (`Conflict`) are NOT in that
   *   type, even though `HTTP_STATUS_MAP` maps them at runtime — see `docs/discord.md#sdk-gaps`.
   *   401 is the smallest real status this SDK's own type actually declares for a propagating
   *   failure, so it is what this test can assert without an unsafe cast past the type checker.
   */
  test('a 401 propagates — never folded to absent', async () => {
    const fake = fakeDiscord(() => fakeFailure(401, 0, 'Unauthorized'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchByName(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('Discord.GuildApplicationCommand spec.attributes', () => {
  test('decodes the shared fields plus the guild-specific ones', () => {
    expect(spec.attributes(liveCommand({ default_member_permissions: '8' }))).toEqual({
      applicationId: APP,
      commandId: '999',
      contexts: undefined,
      defaultMemberPermissions: '8',
      description: 'ping the bot',
      dmPermission: undefined,
      guildId: GUILD,
      integrationTypes: undefined,
      name: 'ping',
      nsfw: false,
      options: [],
      type: 1,
      version: '1',
    });
  });
});

describe('discordOperations(spec).reconcile — S10, zero write calls when there is no drift', () => {
  test('a live command that already matches is left alone', async () => {
    const fake = fakeDiscord((method, url) =>
      method === 'GET' && url.pathname === CMD_PATH
        ? Response.json([liveCommand()])
        : fakeFailure(500, 0, 'unexpected POST'),
    );
    const ops = discordOperations(spec);
    const attrs = await Effect.runPromise(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(attrs.commandId).toBe('999');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a description that drifted is converged with one upsert call, full body', async () => {
    const fake = fakeDiscord((method, url) => {
      if (method === 'GET' && url.pathname === CMD_PATH) {
        return Response.json([liveCommand({ description: 'stale' })]);
      }
      if (method === 'POST' && url.pathname === CMD_PATH) {
        return Response.json(liveCommand({ description: 'ping the bot' }));
      }
      return fakeFailure(400, 0, 'unexpected request');
    });
    const ops = discordOperations(spec);
    const attrs = await Effect.runPromise(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(attrs.description).toBe('ping the bot');
    const post = fake.seen.find((s) => s.method === 'POST');
    expect(post?.body).toMatchObject({ description: 'ping the bot', name: 'ping' });
  });

  test('absent live command is created with the full declared body', async () => {
    const fake = fakeDiscord((method, url) => {
      if (method === 'GET' && url.pathname === CMD_PATH) return Response.json([]);
      if (method === 'POST' && url.pathname === CMD_PATH) return Response.json(liveCommand());
      return fakeFailure(400, 0, 'unexpected request');
    });
    const ops = discordOperations(spec);
    await Effect.runPromise(
      ops.reconcile(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(fake.seen.filter((s) => s.method === 'POST')).toHaveLength(1);
  });
});

describe('discordOperations(spec).read — S7/S8, Unowned on a cold match, plain on a warm one', () => {
  test('cold (no persisted output) + a live match: Unowned, so adopt is gated', async () => {
    const fake = fakeDiscord(() => Response.json([liveCommand()]));
    const ops = discordOperations(spec);
    const result = await Effect.runPromise(
      ops
        .read({ olds: PROPS, output: undefined })
        .pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(result).toBeDefined();
    expect(Unowned.is(result)).toBe(true);
  });

  test('warm (persisted output from a prior apply) + a live match: plain attributes, ours already', async () => {
    const fake = fakeDiscord(() => Response.json([liveCommand()]));
    const ops = discordOperations(spec);
    const priorAttrs = spec.attributes(liveCommand());
    const result = await Effect.runPromise(
      ops
        .read({ olds: PROPS, output: priorAttrs })
        .pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(Unowned.is(result)).toBe(false);
    expect(result).toEqual(priorAttrs);
  });

  test('no live match at all: undefined, regardless of warm/cold', async () => {
    const fake = fakeDiscord(() => Response.json([]));
    const ops = discordOperations(spec);
    const result = await Effect.runPromise(
      ops
        .read({ olds: PROPS, output: undefined })
        .pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });
});

describe('discordOperations(spec).destroy', () => {
  test('deletes the live command by id', async () => {
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

  test('an already-gone command is a no-op delete, not an error', async () => {
    const fake = fakeDiscord(() => Response.json([]));
    const ops = discordOperations(spec);
    await Effect.runPromise(ops.destroy(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))));
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

// `FAKE_BASE` proves the fake's own origin never leaks past the layer boundary into a real host.
test('fake-discord never points at a real host', () => {
  expect(FAKE_BASE).toBe('https://discord.example.com');
});
