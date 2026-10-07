/**
 * `LiteLLM.ToolPolicy` through Alchemy's real Plan and Apply over the fake proxy
 * (`fake-tool-litellm.ts`): the upsert create, no-op, adopt, partial update, replace and reset.
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
import { type FakeToolLitellm, startFakeToolLitellm, toolRow } from './fake-tool-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMToolPolicy } from './tool-policy.ts';
import { resetToolPolicy } from './tool-policy-operations.ts';
import type { ToolPolicyProps } from './tool-policy-types.ts';

const stack = (fake: FakeToolLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: ToolPolicyProps, name = 'Search') =>
  Effect.gen(function* () {
    yield* LiteLLMToolPolicy(name, props);
  });

const search: ToolPolicyProps = {
  inputPolicy: 'blocked',
  outputPolicy: 'untrusted',
  toolName: 'FAKE_search-query',
};

test('a tool never seen is created by the upsert, then a second deploy writes nothing', async () => {
  const fake = startFakeToolLitellm();
  const same = stack(fake);
  expect(await same.deploy(declare(search))).toEqual({ Search: 'create' });
  expect(fake.tools()[0]).toMatchObject({
    input_policy: 'blocked',
    output_policy: 'untrusted',
    tool_name: 'FAKE_search-query',
  });
  expect(fake.bodies()[0]).toEqual({
    input_policy: 'blocked',
    output_policy: 'untrusted',
    tool_name: 'FAKE_search-query',
  });
  const before = fake.requests().length;
  expect(await same.deploy(declare(search))).toEqual({ Search: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a tool LiteLLM already discovered is Unowned: refused without --adopt, and a matching row writes nothing', async () => {
  const seen = toolRow({
    input_policy: 'blocked',
    tool_id: 'FAKE-tool-live',
    tool_name: 'FAKE_search-query',
  });
  const fake = startFakeToolLitellm({ seed: [seen] });
  const engine = stack(fake);
  await expect(engine.deploy(declare(search))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(Object.values(await engine.deploy(declare(search), { adopt: true }))).toEqual(['adopted']);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('adopting a tool with another policy sends ONLY the field that differs, and leaves the other alone', async () => {
  const seen = toolRow({
    output_policy: 'trusted',
    tool_id: 'FAKE-tool-live',
    tool_name: 'FAKE_search-query',
  });
  const fake = startFakeToolLitellm({ seed: [seen] });
  await stack(fake).deploy(declare({ inputPolicy: 'blocked', toolName: 'FAKE_search-query' }), {
    adopt: true,
  });
  expect(fake.bodies()).toEqual([{ input_policy: 'blocked', tool_name: 'FAKE_search-query' }]);
  // ★ the output policy was never declared, so it is not compared and not sent
  expect(fake.tools()[0]?.['output_policy']).toBe('trusted');
});

test('a changed policy is an update that sends only the changed field', async () => {
  const fake = startFakeToolLitellm();
  const same = stack(fake);
  await same.deploy(declare(search));
  expect(await same.deploy(declare({ ...search, inputPolicy: 'trusted' }))).toEqual({
    Search: 'update',
  });
  expect(fake.bodies().at(-1)).toEqual({ input_policy: 'trusted', tool_name: 'FAKE_search-query' });
});

test('a different tool name is a replace, create-first, and the old tool is retained', async () => {
  const fake = startFakeToolLitellm();
  const same = stack(fake);
  await same.deploy(declare(search));
  expect(await same.deploy(declare({ ...search, toolName: 'FAKE_other-tool' }))).toEqual({
    Search: 'replace',
  });
  expect(fake.tools().map((row) => row['tool_name'])).toEqual([
    'FAKE_search-query',
    'FAKE_other-tool',
  ]);
});

test('a proxy that drops a field fails the deploy instead of claiming success', async () => {
  // ⚠️ the fake's own model of a route that loses one field — unmeasured at 1.103.0
  const fake = startFakeToolLitellm({ dropsOutputPolicy: true });
  await expect(
    stack(fake).deploy(declare({ ...search, outputPolicy: 'trusted' })),
  ).rejects.toThrow();
});

test('a read that 404s for a tool that exists ends in a write that succeeds, not in a wrong "absent"', async () => {
  // ⛔ measured in the source: db_get_tool swallows every exception into None, which the route makes a 404
  const seen = toolRow({ tool_id: 'FAKE-tool-live', tool_name: 'FAKE_search-query' });
  const fake = startFakeToolLitellm({ getSwallowsErrors: true, seed: [seen] });
  await expect(stack(fake).deploy(declare(search))).rejects.toThrow();
  // the write reached the proxy (an upsert), and the read back is what refused to call it converged
  expect(writesOf(fake.requests())).toEqual(['POST /v1/tool/policy']);
});

test('a refused declaration fails the plan before a single request', async () => {
  for (const props of [
    { toolName: 'FAKE_search-query' },
    { ...search, toolName: ' ' },
    { ...search, toolName: 'list' },
    { ...search, toolName: 'spend' },
    { ...search, toolName: 'policy/options' },
    { ...search, toolName: 'x/detail' },
    { ...search, toolName: 'x/logs' },
    { ...search, inputPolicy: 'dual_llm' as never },
    { ...search, outputPolicy: 'blocked' as never },
  ]) {
    const fake = startFakeToolLitellm();
    await expect(stack(fake).deploy(declare(props))).rejects.toThrow();
    expect(fake.requests()).toEqual([]);
  }
});

test('removing the declaration RETAINS the tool row', async () => {
  const fake = startFakeToolLitellm();
  const same = stack(fake);
  await same.deploy(declare(search));
  await same.deploy(Effect.void);
  expect(fake.tools()[0]).toMatchObject({ input_policy: 'blocked' });
});

const run = <A, E>(fetchFn: typeof globalThis.fetch, effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

test('delete RESETS only the managed fields that are not already the default, and sends nothing for an unknown tool', async () => {
  const seen = toolRow({
    input_policy: 'blocked',
    output_policy: 'trusted',
    tool_id: 'FAKE-tool-live',
    tool_name: 'FAKE_search-query',
  });
  const fake = startFakeToolLitellm({ seed: [seen] });
  await run(fake.fetch, resetToolPolicy({ inputPolicy: 'blocked', toolName: 'FAKE_search-query' }));
  // ★ only the declared field was reset; the undeclared output policy keeps what it had
  expect(fake.tools()[0]).toMatchObject({ input_policy: 'untrusted', output_policy: 'trusted' });
  const before = fake.requests().length;
  await run(fake.fetch, resetToolPolicy({ inputPolicy: 'blocked', toolName: 'FAKE_search-query' }));
  await run(fake.fetch, resetToolPolicy({ inputPolicy: 'blocked', toolName: 'FAKE_unknown' }));
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});
