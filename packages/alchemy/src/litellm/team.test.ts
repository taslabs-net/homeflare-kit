/**
 * `LiteLLM.Team` through Alchemy's real Plan and Apply over the fake proxy (`fake-team-litellm.ts`):
 * create, no-op, adopt, the partial update, the object-permission merge and the refusals. The roster
 * and delete are `team-members.test.ts`.
 *
 * ★ EVERY VALUE IS `FAKE-*`.
 * ⚠️ WHAT THE FAKE MODELS IS READ FROM THE 1.103.0 SOURCE, NOT MEASURED ON A LIVE PROXY (its header).
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { FAKE_KEY } from './fake-registry-base.ts';
import { type FakeTeamLitellm, startFakeTeamLitellm, teamRow } from './fake-team-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMTeam } from './team.ts';
import type { TeamProps } from './team-types.ts';

const stack = (fake: FakeTeamLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: TeamProps, name = 'Estate') =>
  Effect.gen(function* () {
    yield* LiteLLMTeam(name, props);
  });

const estate: TeamProps = {
  blocked: false,
  models: ['fake-code', 'fake-flash'],
  objectPermission: {
    mcpServers: [],
    mcpToolsets: ['FAKE-toolset-1'],
    mcpToolPermissions: { FAKE_docs: ['search'] },
  },
  teamAlias: 'FAKE-estate',
  teamId: 'FAKE-team-estate',
};

test('creates a team with its ceiling, then a second deploy writes nothing', async () => {
  const fake = startFakeTeamLitellm();
  const same = stack(fake);
  expect(await same.deploy(declare(estate))).toEqual({ Estate: 'create' });
  expect(fake.teams()[0]).toMatchObject({
    blocked: false,
    models: ['fake-code', 'fake-flash'],
    object_permission: {
      mcp_servers: [],
      mcp_tool_permissions: { FAKE_docs: ['search'] },
      mcp_toolsets: ['FAKE-toolset-1'],
    },
    team_alias: 'FAKE-estate',
    team_id: 'FAKE-team-estate',
  });
  const before = fake.requests().length;
  expect(await same.deploy(declare(estate))).toEqual({ Estate: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('an undeclared team id is a deterministic physical name, never a proxy uuid', async () => {
  const fake = startFakeTeamLitellm();
  await stack(fake).deploy(declare({ teamAlias: 'FAKE-named' }));
  expect(String(fake.teams()[0]?.['team_id'])).toMatch(/^[a-z0-9-]+$/);
});

test('an undeclared field is never sent: a create with only an alias sends no models, no block, no permission', async () => {
  const fake = startFakeTeamLitellm();
  await stack(fake).deploy(declare({ teamAlias: 'FAKE-bare', teamId: 'FAKE-team-bare' }));
  expect(fake.bodies()[0]).toEqual({ team_alias: 'FAKE-bare', team_id: 'FAKE-team-bare' });
});

test('`models: []` is sent as an empty list (it means EVERY model), not dropped', async () => {
  const fake = startFakeTeamLitellm();
  await stack(fake).deploy(
    declare({ models: [], teamAlias: 'FAKE-open', teamId: 'FAKE-team-open' }),
  );
  expect(fake.bodies()[0]).toMatchObject({ models: [] });
});

test('a live team is Unowned: refused without --adopt, adopted by id with it, and a match writes nothing', async () => {
  const live = teamRow({
    blocked: false,
    models: ['fake-flash', 'fake-code'],
    object_permission: {
      mcp_servers: [],
      mcp_tool_permissions: { FAKE_docs: ['search'] },
      mcp_toolsets: ['FAKE-toolset-1'],
    },
    team_alias: 'FAKE-estate',
    team_id: 'FAKE-team-estate',
  });
  const fake = startFakeTeamLitellm({ seed: [live] });
  const engine = stack(fake);
  await expect(engine.deploy(declare(estate))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(Object.values(await engine.deploy(declare(estate), { adopt: true }))).toEqual(['adopted']);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('the object permission is a MERGE: adopting a team corrects the declared field and leaves the others', async () => {
  const live = teamRow({
    models: ['fake-code'],
    object_permission: {
      mcp_servers: ['FAKE-server-a'],
      mcp_toolsets: ['FAKE-toolset-1'],
      vector_stores: ['FAKE-vector'],
    },
    team_alias: 'FAKE-estate',
    team_id: 'FAKE-team-estate',
  });
  const fake = startFakeTeamLitellm({ seed: [live] });
  await stack(fake).deploy(
    declare({
      objectPermission: { mcpServers: [] },
      teamAlias: 'FAKE-estate',
      teamId: 'FAKE-team-estate',
    }),
    { adopt: true },
  );
  // ★ the red-team fact: a non-empty team `mcp_servers` intersects every key's grants, so it is cleared
  expect(fake.bodies()[0]).toEqual({
    object_permission: { mcp_servers: [] },
    team_id: 'FAKE-team-estate',
  });
  expect(fake.teams()[0]?.['object_permission']).toEqual({
    mcp_servers: [],
    mcp_toolsets: ['FAKE-toolset-1'],
    vector_stores: ['FAKE-vector'],
  });
  expect(fake.teams()[0]?.['models']).toEqual(['fake-code']);
});

test('a changed field is an update that sends the id and ONLY what changed', async () => {
  const fake = startFakeTeamLitellm();
  const same = stack(fake);
  await same.deploy(declare(estate));
  const planned = await same.deploy(
    declare({
      ...estate,
      blocked: true,
      objectPermission: { ...estate.objectPermission, blockedTools: ['FAKE_docs-danger'] },
    }),
  );
  expect(planned).toEqual({ Estate: 'update' });
  expect(fake.bodies().at(-1)).toEqual({
    blocked: true,
    object_permission: { blocked_tools: ['FAKE_docs-danger'] },
    team_id: 'FAKE-team-estate',
  });
});

test('a proxy that hands mcp_tool_permissions back as a JSON string is still a no-op', async () => {
  const fake = startFakeTeamLitellm({ toolPermissionsAsString: true });
  const same = stack(fake);
  await same.deploy(declare(estate));
  const before = fake.requests().length;
  expect(await same.deploy(declare(estate))).toEqual({ Estate: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('access group ids are compared as a set, and only when declared', async () => {
  const fake = startFakeTeamLitellm();
  const same = stack(fake);
  await same.deploy(declare({ ...estate, accessGroupIds: ['FAKE-group-b', 'FAKE-group-a'] }));
  expect(
    await same.deploy(declare({ ...estate, accessGroupIds: ['FAKE-group-a', 'FAKE-group-b'] })),
  ).toEqual({
    Estate: 'noop',
  });
  expect(await same.deploy(declare({ ...estate, accessGroupIds: ['FAKE-group-a'] }))).toEqual({
    Estate: 'update',
  });
  expect(fake.bodies().at(-1)).toEqual({
    access_group_ids: ['FAKE-group-a'],
    team_id: 'FAKE-team-estate',
  });
});

test('a changed declared team id is a replace, create-first, and the old team is retained', async () => {
  const fake = startFakeTeamLitellm();
  const same = stack(fake);
  await same.deploy(declare(estate));
  expect(await same.deploy(declare({ ...estate, teamId: 'FAKE-team-other' }))).toEqual({
    Estate: 'replace',
  });
  expect(fake.teams().map((row) => row['team_id'])).toEqual([
    'FAKE-team-estate',
    'FAKE-team-other',
  ]);
  expect(fake.deletedKeys()).toEqual([]);
});

test('a refused declaration fails the plan before a single request', async () => {
  for (const props of [
    { ...estate, teamAlias: ' ' },
    { ...estate, teamId: ' padded' },
    { ...estate, models: ['a', 'a'] },
    { ...estate, accessGroupIds: [''] },
    { ...estate, objectPermission: { mcpServers: ['all-proxy-mcpservers'] } },
    { ...estate, objectPermission: { mcpToolsets: ['x', 'x'] } },
    { ...estate, objectPermission: { mcpToolPermissions: { ' ': ['a'] } } },
    { ...estate, members: [{ userId: 'a' }, { userId: 'a' }] },
    { ...estate, members: [{ role: 'owner' as never, userId: 'a' }] },
  ]) {
    const fake = startFakeTeamLitellm();
    await expect(stack(fake).deploy(declare(props))).rejects.toThrow();
    expect(fake.requests()).toEqual([]);
  }
});
