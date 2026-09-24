/**
 * Discord's 429 handling — proving the SDK's OWN default retry policy (`@distilled.cloud/core`'s
 * `makeDefault`, threaded through every operation via `retry: Retry.Retry` — see `resource.ts`'s
 * header note and `docs/discord.md#rate-limits`), not a house re-implementation. This file exists
 * because "respect Discord's rate limits with a bounded retry" is a requirement this task must
 * satisfy, and the honest way to satisfy it here is to prove the SDK already does — nothing in
 * `resource.ts` installs a `Discord.Retry.policy` of its own, so if this test ever failed to
 * retry, or failed to STOP retrying, there would be nothing in this package to fix; the fix would
 * be in `@distilled.cloud/discord`.
 *
 * ⛔ A TEST THAT CANNOT FAIL PROVES NOTHING. Both cases below assert on the fake's own call count
 *   (`fake.seen.length`), not just on the eventual Effect outcome — a policy that retried once,
 *   or one that retried forever, would each still "eventually succeed" or "eventually fail" on
 *   SOME outcome; the call count is what makes "bounded" a real, checkable claim rather than an
 *   assumption the test's own passing would not have caught.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { spec } from './guild-application-command.ts';
import type { GuildApplicationCommandProps } from './guild-application-command.ts';
import { fakeDiscord, fakeDiscordLayer, fakeRateLimited } from './fake-discord.ts';

const APP = '111111111111111111';
const GUILD = '222222222222222222';
const CMD_PATH = `/applications/${APP}/guilds/${GUILD}/commands`;
const PROPS: GuildApplicationCommandProps = { applicationId: APP, guildId: GUILD, name: 'ping' };

const liveCommand = () => ({
  application_id: APP,
  default_member_permissions: null,
  description: '',
  guild_id: GUILD,
  id: '999',
  name: 'ping',
  nsfw: false,
  type: 1,
  version: '1',
});

describe('the SDK default Retry policy on a 429', () => {
  test('two 429s (Retry-After: 0) then a 200 — retried, and it converges', async () => {
    const fake = fakeDiscord((method, url, _body, callNumber) => {
      if (method !== 'GET' || url.pathname !== CMD_PATH) return new Response(null, { status: 500 });
      return callNumber <= 2 ? fakeRateLimited(0) : Response.json([liveCommand()]);
    });
    const live = await Effect.runPromise(
      spec.fetchByName(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch))),
    );
    expect(live?.id).toBe('999');
    expect(fake.seen).toHaveLength(3);
  }, 15_000);

  /**
   * ★ THE BOUND ITSELF. `@distilled.cloud/core`'s `makeDefault` caps this at `Schedule.recurs(8)`
   *   — 8 retries, 9 attempts total — regardless of how long the server keeps answering 429. A
   *   server that never recovers must still let the caller find out, in bounded time, rather than
   *   parking the fiber forever; that is the literal meaning of "bounded retry".
   */
  test('429 forever is a bounded number of attempts, then a typed failure — never an infinite loop', async () => {
    const fake = fakeDiscord((method, url) =>
      method === 'GET' && url.pathname === CMD_PATH
        ? fakeRateLimited(0)
        : new Response(null, { status: 500 }),
    );
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchByName(PROPS).pipe(Effect.provide(fakeDiscordLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('TooManyRequests');
    // 1 initial attempt + at most 8 retries. Strictly greater than 1 proves a retry happened at
    // all; at most 9 proves it stopped rather than continuing past the documented bound.
    expect(fake.seen.length).toBeGreaterThan(1);
    expect(fake.seen.length).toBeLessThanOrEqual(9);
  }, 15_000);
});
