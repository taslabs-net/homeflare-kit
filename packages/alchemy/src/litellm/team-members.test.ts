/**
 * `LiteLLM.Team`'s roster (additive only) and its delete (which deletes the team's keys), over the fake
 * proxy (`fake-team-litellm.ts`).
 *
 * ★ EVERY VALUE IS `FAKE-*`.
 * ⚠️ WHAT THE FAKE MODELS IS READ FROM THE 1.103.0 SOURCE, NOT MEASURED ON A LIVE PROXY (its header).
 */
import { expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { FAKE_BASE } from './fake-litellm.ts';
import { FAKE_KEY } from './fake-registry-base.ts';
import { type FakeTeamLitellm, startFakeTeamLitellm, teamRow } from './fake-team-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMTeam } from './team.ts';
import { deleteTeam } from './team-operations.ts';
import type { TeamProps } from './team-types.ts';

const stack = (fake: FakeTeamLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: TeamProps, name = 'Estate') =>
  Effect.gen(function* () {
    yield* LiteLLMTeam(name, props);
  });

const seats: TeamProps = {
  members: [{ userId: 'FAKE-user-a' }, { userId: 'FAKE-user-b' }],
  teamAlias: 'FAKE-seats',
  teamId: 'FAKE-team-seats',
};

const roster = (fake: FakeTeamLitellm) => {
  const members = (fake.teams()[0]?.['members_with_roles'] ?? []) as {
    user_id: string;
    role: string;
  }[];
  return members.map((member) => `${member.user_id}:${member.role}`);
};

test('adds the declared members in ONE call, and the caller LiteLLM auto-adds as admin is not drift', async () => {
  const fake = startFakeTeamLitellm();
  const same = stack(fake);
  expect(await same.deploy(declare(seats))).toEqual({ Estate: 'create' });
  expect(roster(fake)).toEqual(['default_user_id:admin', 'FAKE-user-a:user', 'FAKE-user-b:user']);
  expect(fake.requests().filter((each) => each.path === '/team/member_add')).toHaveLength(1);
  const before = fake.requests().length;
  expect(await same.deploy(declare(seats))).toEqual({ Estate: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a new member on an existing roster is added alone, and nobody is ever removed', async () => {
  const fake = startFakeTeamLitellm();
  const same = stack(fake);
  await same.deploy(declare(seats));
  await same.deploy(declare({ ...seats, members: [{ userId: 'FAKE-user-c' }] }));
  // ★ user-a and user-b are not declared any more and are still there
  expect(roster(fake)).toEqual([
    'default_user_id:admin',
    'FAKE-user-a:user',
    'FAKE-user-b:user',
    'FAKE-user-c:user',
  ]);
  expect(fake.requests().some((each) => each.path === '/team/member_delete')).toBe(false);
});

test('a member with another role is updated through member_update, not re-added', async () => {
  const live = teamRow({
    members_with_roles: [{ role: 'admin', user_email: null, user_id: 'FAKE-user-a' }],
    team_alias: 'FAKE-seats',
    team_id: 'FAKE-team-seats',
  });
  const fake = startFakeTeamLitellm({ seed: [live] });
  await stack(fake).deploy(
    declare({ ...seats, members: [{ role: 'user', userId: 'FAKE-user-a' }] }),
    {
      adopt: true,
    },
  );
  expect(fake.requests().some((each) => each.path === '/team/member_add')).toBe(false);
  expect(fake.requests().filter((each) => each.path === '/team/member_update')).toHaveLength(1);
  expect(roster(fake)).toEqual(['FAKE-user-a:user']);
});

test('an admin member on a proxy without a licence fails the deploy and leaves the roster as it was', async () => {
  // ⛔ measured in the source: team_endpoints.py lines 2713-2723 and 3806-3810 (Enterprise)
  const fake = startFakeTeamLitellm({ community: true });
  await expect(
    stack(fake).deploy(declare({ ...seats, members: [{ role: 'admin', userId: 'FAKE-user-a' }] })),
  ).rejects.toThrow();
  expect(roster(fake)).toEqual(['default_user_id:admin']);
});

test('the same declaration on a licensed proxy adds the admin', async () => {
  const fake = startFakeTeamLitellm({ community: false });
  await stack(fake).deploy(
    declare({ ...seats, members: [{ role: 'admin', userId: 'FAKE-user-a' }] }),
  );
  expect(roster(fake)).toContain('FAKE-user-a:admin');
});

test('undeclared members leave the roster alone: no member_add and no read-back drift', async () => {
  const fake = startFakeTeamLitellm();
  await stack(fake).deploy(declare({ teamAlias: 'FAKE-seats', teamId: 'FAKE-team-seats' }));
  expect(fake.requests().some((each) => each.path === '/team/member_add')).toBe(false);
});

test('removing the declaration RETAINS the team and its keys', async () => {
  const fake = startFakeTeamLitellm();
  const same = stack(fake);
  await same.deploy(declare(seats));
  await same.deploy(Effect.void);
  expect(fake.teams()).toHaveLength(1);
  expect(fake.deletedKeys()).toEqual([]);
});

const run = <A, E>(fetchFn: typeof globalThis.fetch, effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

test('delete removes the team AND records that LiteLLM deleted its keys', async () => {
  const fake = startFakeTeamLitellm({
    seed: [teamRow({ team_alias: 'FAKE-seats', team_id: 'FAKE-team-seats' })],
  });
  await run(fake.fetch, deleteTeam('FAKE-team-seats'));
  expect(fake.teams()).toEqual([]);
  expect(fake.deletedKeys()).toEqual(['FAKE-team-seats']);
});

test('delete of a team that is gone is swallowed only because /team/list confirms it', async () => {
  const fake = startFakeTeamLitellm();
  await run(fake.fetch, deleteTeam('FAKE-team-gone'));
  expect(fake.requests().map((each) => each.path)).toEqual(['/team/delete', '/team/list']);
});

test('a 404 for a team that is still listed (a swallowed database error) re-raises the ORIGINAL error', async () => {
  // ⛔ measured in the source: /team/delete answers 404 for any exception on its lookup
  const fake = startFakeTeamLitellm({
    deleteLies: true,
    seed: [teamRow({ team_alias: 'FAKE-seats', team_id: 'FAKE-team-seats' })],
  });
  await expect(run(fake.fetch, deleteTeam('FAKE-team-seats'))).rejects.toThrow();
  expect(fake.teams()).toHaveLength(1);
});
