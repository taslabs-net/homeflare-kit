/**
 * `LiteLLM.AccessGroup` through Alchemy's real Plan and Apply over the fake proxy
 * (`fake-access-group-litellm.ts`): create, no-op, adopt, update, rename, drift and delete.
 *
 * ★ EVERY VALUE IS `FAKE-*`.
 * ⚠️ WHAT THE FAKE MODELS IS READ FROM THE 1.103.0 SOURCE, NOT MEASURED ON A LIVE PROXY (its header).
 */
import { expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { LiteLLMAccessGroup } from './access-group.ts';
import { deleteAccessGroup } from './access-group-operations.ts';
import type { AccessGroupProps } from './access-group-types.ts';
import { FAKE_BASE } from './fake-litellm.ts';
import {
  type FakeAccessGroupLitellm,
  groupRow,
  startFakeAccessGroupLitellm,
} from './fake-access-group-litellm.ts';
import { FAKE_KEY } from './fake-registry-base.ts';
import { fakeStack, writesOf } from './fake-stack.ts';

const stack = (fake: FakeAccessGroupLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: AccessGroupProps, name = 'Estate') =>
  Effect.gen(function* () {
    yield* LiteLLMAccessGroup(name, props);
  });

const estate: AccessGroupProps = {
  accessGroupName: 'FAKE-estate',
  description: 'FAKE estate group',
  mcpServerIds: ['FAKE-server-a'],
  modelNames: ['fake-code', 'fake-flash'],
};

test('creates a group with both grant lists, then a second deploy writes nothing', async () => {
  const fake = startFakeAccessGroupLitellm();
  const same = stack(fake);
  expect(await same.deploy(declare(estate))).toEqual({ Estate: 'create' });
  expect(fake.groups()[0]).toMatchObject({
    access_group_name: 'FAKE-estate',
    access_mcp_server_ids: ['FAKE-server-a'],
    access_model_names: ['fake-code', 'fake-flash'],
    description: 'FAKE estate group',
  });
  // ★ the id is the proxy's, and it is what the state remembers
  expect(String(fake.groups()[0]?.['access_group_id'])).toStartWith('FAKE-group-');
  const before = fake.requests().length;
  expect(await same.deploy(declare(estate))).toEqual({ Estate: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('an undeclared grant list means "grants nothing": it is sent as an empty list on create', async () => {
  const fake = startFakeAccessGroupLitellm();
  await stack(fake).deploy(declare({ accessGroupName: 'FAKE-empty' }));
  expect(fake.bodies()[0]).toMatchObject({ access_mcp_server_ids: [], access_model_names: [] });
  expect(fake.bodies()[0]).not.toHaveProperty('description');
});

test('a changed model set is an update that sends ONLY the field that changed', async () => {
  const fake = startFakeAccessGroupLitellm();
  const same = stack(fake);
  await same.deploy(declare(estate));
  const planned = await same.deploy(declare({ ...estate, modelNames: ['fake-code'] }));
  expect(planned).toEqual({ Estate: 'update' });
  expect(fake.bodies().at(-1)).toEqual({ access_model_names: ['fake-code'] });
  expect(fake.groups()[0]?.['access_mcp_server_ids']).toEqual(['FAKE-server-a']);
});

test('a rename is an update of the SAME row: the id does not change', async () => {
  const fake = startFakeAccessGroupLitellm();
  const same = stack(fake);
  await same.deploy(declare(estate));
  const id = fake.groups()[0]?.['access_group_id'];
  expect(await same.deploy(declare({ ...estate, accessGroupName: 'FAKE-renamed' }))).toEqual({
    Estate: 'update',
  });
  expect(fake.groups()).toHaveLength(1);
  expect(fake.groups()[0]).toMatchObject({
    access_group_id: id,
    access_group_name: 'FAKE-renamed',
  });
});

test('a live row is Unowned: refused without --adopt, taken by name with it, and a matching row writes nothing', async () => {
  const live = groupRow({
    access_group_id: 'FAKE-live-1',
    access_group_name: 'FAKE-estate',
    access_mcp_server_ids: ['FAKE-server-a'],
    access_model_names: ['fake-code', 'fake-flash'],
    description: 'FAKE estate group',
  });
  const fake = startFakeAccessGroupLitellm({ seed: [live] });
  const engine = stack(fake);
  await expect(engine.deploy(declare(estate))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(Object.values(await engine.deploy(declare(estate), { adopt: true }))).toEqual(['adopted']);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('adopting a group that grants MORE than declared corrects it, and leaves undeclared text and teams alone', async () => {
  const wide = groupRow({
    access_group_id: 'FAKE-live-2',
    access_group_name: 'FAKE-estate',
    access_mcp_server_ids: ['FAKE-server-a', 'FAKE-server-extra'],
    access_model_names: ['fake-code', 'fake-flash', 'fake-extra'],
    assigned_team_ids: ['FAKE-team-1'],
    description: 'written by a person',
  });
  const fake = startFakeAccessGroupLitellm({ seed: [wide] });
  const { description: _kept, ...withoutDescription } = estate;
  await stack(fake).deploy(declare(withoutDescription), { adopt: true });
  expect(fake.groups()[0]).toMatchObject({
    access_mcp_server_ids: ['FAKE-server-a'],
    access_model_names: ['fake-code', 'fake-flash'],
    assigned_team_ids: ['FAKE-team-1'],
    description: 'written by a person',
  });
  // ★ a partial update: the team edge is not in the body at all
  expect(fake.bodies()[0]).not.toHaveProperty('assigned_team_ids');
  expect(fake.bodies()[0]).not.toHaveProperty('description');
});

test('reconcile compares the LIVE row: after LiteLLM prunes a model name itself, the next update puts it back', async () => {
  const fake = startFakeAccessGroupLitellm();
  const same = stack(fake);
  await same.deploy(declare(estate));
  fake.dropModel('fake-flash'); // ⚠️ access_group_model_sync.py: a deleted last deployment
  // ★ Alchemy plans from state, so an unchanged declaration is a no-op even now (beta.79 reads live
  //   state only to adopt); a declaration that changes anything reaches reconcile, which reads live
  expect(await same.deploy(declare(estate))).toEqual({ Estate: 'noop' });
  expect(await same.deploy(declare({ ...estate, description: 'FAKE changed' }))).toEqual({
    Estate: 'update',
  });
  expect(fake.bodies().at(-1)).toEqual({
    access_model_names: ['fake-code', 'fake-flash'],
    description: 'FAKE changed',
  });
});

test('a proxy that drops an empty-list edit fails the deploy instead of claiming success', async () => {
  // ⚠️ the fake's own model of a truthiness check on the edit route — unmeasured at 1.103.0
  const fake = startFakeAccessGroupLitellm({ editIgnoresEmpty: true });
  const same = stack(fake);
  await same.deploy(declare(estate));
  await expect(same.deploy(declare({ ...estate, mcpServerIds: [] }))).rejects.toThrow();
});

test('a refused declaration fails the plan before a single request', async () => {
  for (const props of [
    { ...estate, accessGroupName: ' ' },
    { ...estate, accessGroupName: ' padded' },
    { ...estate, description: '  ' },
    { ...estate, modelNames: ['fake-code', 'fake-code'] },
    { ...estate, mcpServerIds: ['FAKE-server-a', ''] },
  ]) {
    const fake = startFakeAccessGroupLitellm();
    await expect(stack(fake).deploy(declare(props))).rejects.toThrow();
    expect(fake.requests()).toEqual([]);
  }
});

test('removing the declaration RETAINS the row: nothing deletes a group unless the stack opts in', async () => {
  const fake = startFakeAccessGroupLitellm();
  const same = stack(fake);
  await same.deploy(declare(estate));
  await same.deploy(Effect.void);
  expect(fake.groups()).toHaveLength(1);
});

const run = <A, E>(fetchFn: typeof globalThis.fetch, effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

test('delete answers 204 with no body, and a missing id is swallowed only because a real read says so', async () => {
  const live = groupRow({ access_group_id: 'FAKE-live-3', access_group_name: 'FAKE-estate' });
  const fake = startFakeAccessGroupLitellm({ seed: [live] });
  await run(fake.fetch, deleteAccessGroup('FAKE-live-3'));
  expect(fake.groups()).toEqual([]);
  // already gone: the DELETE 404s, the re-list confirms absence, so it is success
  await run(fake.fetch, deleteAccessGroup('FAKE-live-3'));
});

test('a delete refused for lack of rights re-raises the ORIGINAL error and the row stays', async () => {
  const live = groupRow({ access_group_id: 'FAKE-live-4', access_group_name: 'FAKE-estate' });
  const fake = startFakeAccessGroupLitellm({ forbidWrites: true, seed: [live] });
  await expect(run(fake.fetch, deleteAccessGroup('FAKE-live-4'))).rejects.toThrow();
  expect(fake.groups()).toHaveLength(1);
});
