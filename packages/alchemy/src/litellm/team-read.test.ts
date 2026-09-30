/**
 * `LiteLLM.Team`'s READ: what a lying `/team/info` and a proxy that drops an edit do to a deploy, and what
 * the read must never copy. Over the fake proxy (`fake-team-litellm.ts`).
 *
 * ★ EVERY VALUE IS `FAKE-*`.
 * ⚠️ WHAT THE FAKE MODELS IS READ FROM THE 1.103.0 SOURCE, NOT MEASURED ON A LIVE PROXY (its header).
 */
import { expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { FAKE_BASE } from './fake-litellm.ts';
import { FAKE_KEY } from './fake-registry-base.ts';
import { type FakeTeamLitellm, startFakeTeamLitellm, teamRow } from './fake-team-litellm.ts';
import { fakeStack } from './fake-stack.ts';
import { LiteLLMTeam, teamHandlers } from './team.ts';
import type { TeamProps } from './team-types.ts';

const stack = (fake: FakeTeamLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: TeamProps, name = 'Estate') =>
  Effect.gen(function* () {
    yield* LiteLLMTeam(name, props);
  });

const estate: TeamProps = {
  models: ['fake-code'],
  teamAlias: 'FAKE-estate',
  teamId: 'FAKE-team-estate',
};

test('a /team/info that lies 404 for an existing team ends in a loud 400 on the create, never a second team', async () => {
  // ⛔ measured in the source: the lookup swallows every exception into a 404
  const live = teamRow({ team_alias: 'FAKE-estate', team_id: 'FAKE-team-estate' });
  const fake = startFakeTeamLitellm({ infoLies: true, seed: [live] });
  await expect(stack(fake).deploy(declare(estate))).rejects.toThrow();
  expect(fake.teams()).toHaveLength(1);
});

test('a proxy that keeps a stale field fails the deploy instead of claiming convergence', async () => {
  const live = teamRow({ team_alias: 'FAKE-estate', team_id: 'FAKE-team-estate' });
  // the fake has no update that drops a field, so declare one it cannot store: a blocked flag it ignores
  const fake = startFakeTeamLitellm({ seed: [live] });
  const original = fake.fetch;
  const dropping = (async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    if (new URL(request.url).pathname === '/team/update') {
      return new Response(JSON.stringify({ data: {} }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    }
    return original(input, init);
  }) as typeof globalThis.fetch;
  await expect(
    fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, dropping).deploy(
      declare({ blocked: true, teamAlias: 'FAKE-estate', teamId: 'FAKE-team-estate' }),
      { adopt: true },
    ),
  ).rejects.toThrow();
});

test('nothing /team/info carries beyond the team itself can reach an attribute: keys, memberships, metadata', async () => {
  // ⚠️ measured in the source: /team/info returns the team's keys (hashed tokens), its memberships and its
  //   metadata, and this resource copies none of them
  const live = teamRow({ team_alias: 'FAKE-estate', team_id: 'FAKE-team-estate' });
  const fake = startFakeTeamLitellm({ leaky: true, seed: [live] });
  const read = await Effect.runPromise(
    teamHandlers
      .read({ id: 'Estate', instanceId: 'i', olds: estate, output: undefined })
      .pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fake.fetch)),
        Effect.provide(credentials({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE })),
      ) as Effect.Effect<unknown, unknown, never>,
  );
  const text = JSON.stringify(read);
  expect(text).toContain('FAKE-team-estate');
  for (const secret of [
    'FAKE-hashed-key',
    'FAKE-callback-secret',
    'FAKE-budget-secret',
    'FAKE-membership-secret',
  ]) {
    expect(text).not.toContain(secret);
  }
});
