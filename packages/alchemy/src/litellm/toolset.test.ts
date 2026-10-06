/**
 * `LiteLLM.Toolset` through Alchemy's real Plan and Apply over the fake proxy
 * (`fake-toolset-litellm.ts`): create, no-op, adopt by name, update, rename and delete.
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
import {
  type FakeToolsetLitellm,
  startFakeToolsetLitellm,
  toolsetRow,
} from './fake-toolset-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMToolset } from './toolset.ts';
import { deleteToolset } from './toolset-operations.ts';
import type { ToolsetProps } from './toolset-types.ts';

const stack = (fake: FakeToolsetLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: ToolsetProps, name = 'Web') =>
  Effect.gen(function* () {
    yield* LiteLLMToolset(name, props);
  });

const web: ToolsetProps = {
  description: 'FAKE web tools',
  tools: [
    { serverId: 'FAKE-server-a', toolName: 'search' },
    { serverId: 'FAKE-server-b', toolName: 'fetch' },
  ],
  toolsetName: 'FAKE-web',
};

test('creates a toolset with the pairs, remembers the id the proxy issued, then writes nothing', async () => {
  const fake = startFakeToolsetLitellm();
  const same = stack(fake);
  expect(await same.deploy(declare(web))).toEqual({ Web: 'create' });
  expect(fake.toolsets()[0]).toMatchObject({
    description: 'FAKE web tools',
    tools: web.tools.map((tool) => ({ server_id: tool.serverId, tool_name: tool.toolName })),
    toolset_name: 'FAKE-web',
  });
  const before = fake.requests().length;
  expect(await same.deploy(declare(web))).toEqual({ Web: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('the list is used ONLY to adopt: with state, every read is by id and the list is never asked', async () => {
  const fake = startFakeToolsetLitellm();
  const same = stack(fake);
  await same.deploy(declare(web));
  const before = fake.requests().length;
  await same.deploy(declare({ ...web, description: 'FAKE changed' }));
  const paths = fake
    .requests()
    .slice(before)
    .map((each) => `${each.method} ${each.path}`);
  expect(paths).not.toContain('GET /v1/mcp/toolset');
  expect(paths.some((path) => path.startsWith('GET /v1/mcp/toolset/FAKE-toolset-'))).toBe(true);
});

test('a changed selection is an update that sends the id and ONLY the changed field', async () => {
  const fake = startFakeToolsetLitellm();
  const same = stack(fake);
  await same.deploy(declare(web));
  const planned = await same.deploy(
    declare({ ...web, tools: [{ serverId: 'FAKE-server-a', toolName: 'search' }] }),
  );
  expect(planned).toEqual({ Web: 'update' });
  expect(fake.bodies().at(-1)).toEqual({
    tools: [{ server_id: 'FAKE-server-a', tool_name: 'search' }],
    toolset_id: 'FAKE-toolset-0001',
  });
});

test('an empty selection is sent as an explicit empty list, because a null would be a no-op', async () => {
  const fake = startFakeToolsetLitellm();
  const same = stack(fake);
  await same.deploy(declare(web));
  await same.deploy(declare({ ...web, tools: [] }));
  expect(fake.bodies().at(-1)).toMatchObject({ tools: [] });
  expect(fake.toolsets()[0]?.['tools']).toEqual([]);
});

test('a rename is an update of the SAME row', async () => {
  const fake = startFakeToolsetLitellm();
  const same = stack(fake);
  await same.deploy(declare(web));
  expect(await same.deploy(declare({ ...web, toolsetName: 'FAKE-renamed' }))).toEqual({
    Web: 'update',
  });
  expect(fake.toolsets()).toHaveLength(1);
  expect(fake.toolsets()[0]).toMatchObject({
    toolset_id: 'FAKE-toolset-0001',
    toolset_name: 'FAKE-renamed',
  });
});

test('a live row is Unowned: refused without --adopt, adopted by name with it, and a matching row writes nothing', async () => {
  const live = toolsetRow({
    description: 'FAKE web tools',
    tools: [
      { server_id: 'FAKE-server-b', tool_name: 'fetch' },
      { server_id: 'FAKE-server-a', tool_name: 'search' },
    ],
    toolset_id: 'FAKE-live-1',
    toolset_name: 'FAKE-web',
  });
  const fake = startFakeToolsetLitellm({ seed: [live] });
  const engine = stack(fake);
  await expect(engine.deploy(declare(web))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(Object.values(await engine.deploy(declare(web), { adopt: true }))).toEqual(['adopted']);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('adopting a toolset with MORE tools than declared corrects it, and keeps undeclared text', async () => {
  const wide = toolsetRow({
    description: 'written by a person',
    tools: [
      { server_id: 'FAKE-server-a', tool_name: 'search' },
      { server_id: 'FAKE-server-b', tool_name: 'fetch' },
      { server_id: 'FAKE-server-b', tool_name: 'FAKE-extra' },
    ],
    toolset_id: 'FAKE-live-2',
    toolset_name: 'FAKE-web',
  });
  const fake = startFakeToolsetLitellm({ seed: [wide] });
  const { description: _kept, ...withoutDescription } = web;
  await stack(fake).deploy(declare(withoutDescription), { adopt: true });
  expect(fake.toolsets()[0]?.['tools']).toHaveLength(2);
  expect(fake.toolsets()[0]?.['description']).toBe('written by a person');
  expect(fake.bodies()[0]).not.toHaveProperty('description');
});

test('a list that swallowed a database error cannot hide an existing name: the create fails on the 409', async () => {
  // ⛔ measured in the source: list_mcp_toolsets answers [] on any exception
  const live = toolsetRow({ toolset_id: 'FAKE-live-3', toolset_name: 'FAKE-web' });
  const fake = startFakeToolsetLitellm({ listSwallowsErrors: true, seed: [live] });
  await expect(stack(fake).deploy(declare(web))).rejects.toThrow();
  expect(fake.toolsets()).toHaveLength(1);
});

test('a refused declaration fails the plan before a single request', async () => {
  for (const props of [
    { ...web, toolsetName: ' ' },
    { ...web, toolsetName: 'a/b' },
    { ...web, description: ' ' },
    { ...web, tools: [{ serverId: '', toolName: 'search' }] },
    { ...web, tools: [web.tools[0], web.tools[0]] as never },
  ]) {
    const fake = startFakeToolsetLitellm();
    await expect(stack(fake).deploy(declare(props))).rejects.toThrow();
    expect(fake.requests()).toEqual([]);
  }
});

test('removing the declaration RETAINS the toolset', async () => {
  const fake = startFakeToolsetLitellm();
  const same = stack(fake);
  await same.deploy(declare(web));
  await same.deploy(Effect.void);
  expect(fake.toolsets()).toHaveLength(1);
});

const run = <A, E>(fetchFn: typeof globalThis.fetch, effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

test('delete answers 202 with no body, and a missing id is swallowed only because a by-id read says so', async () => {
  const fake = startFakeToolsetLitellm({
    seed: [toolsetRow({ toolset_id: 'FAKE-live-4', toolset_name: 'FAKE-web' })],
  });
  await run(fake.fetch, deleteToolset('FAKE-live-4'));
  expect(fake.toolsets()).toEqual([]);
  await run(fake.fetch, deleteToolset('FAKE-live-4'));
});

test('a delete refused for lack of rights re-raises the ORIGINAL error and the row stays', async () => {
  const fake = startFakeToolsetLitellm({
    forbidWrites: true,
    seed: [toolsetRow({ toolset_id: 'FAKE-live-5', toolset_name: 'FAKE-web' })],
  });
  await expect(run(fake.fetch, deleteToolset('FAKE-live-5'))).rejects.toThrow();
  expect(fake.toolsets()).toHaveLength(1);
});
