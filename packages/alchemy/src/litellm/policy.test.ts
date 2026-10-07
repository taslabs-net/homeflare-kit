/**
 * `LiteLLM.Policy` through Alchemy's real Plan and Apply over the fake proxy (`fake-policy-litellm.ts`):
 * create, no-op, the draft → published → production promotion, adopt, config-file collision, replace.
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
  type FakePolicyLitellm,
  policyRow,
  startFakePolicyLitellm,
} from './fake-policy-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMPolicy, policyHandlers } from './policy.ts';
import type { PolicyProps } from './policy-types.ts';

const stack = (fake: FakePolicyLitellm) =>
  fakeStack({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: PolicyProps, name = 'Baseline') =>
  Effect.gen(function* () {
    yield* LiteLLMPolicy(name, props);
  });

const baseline: PolicyProps = {
  description: 'FAKE baseline',
  guardrailsAdd: ['fake-pii', 'fake-injection'],
  policyName: 'FAKE-baseline',
};

const statuses = (fake: FakePolicyLitellm) =>
  fake.versions().map((row) => `${String(row['version_number'])}:${String(row['version_status'])}`);

test('creates version 1 as production after a config-collision check, then a second deploy writes nothing', async () => {
  const fake = startFakePolicyLitellm();
  const same = stack(fake);
  expect(await same.deploy(declare(baseline))).toEqual({ Baseline: 'create' });
  expect(fake.requests().map((each) => each.path)).toContain(
    '/policies/list?version_status=production',
  );
  expect(fake.versions()).toHaveLength(1);
  expect(fake.versions()[0]).toMatchObject({
    description: 'FAKE baseline',
    guardrails_add: ['fake-pii', 'fake-injection'],
    guardrails_remove: [],
    policy_name: 'FAKE-baseline',
    version_number: 1,
    version_status: 'production',
  });
  const before = fake.requests().length;
  expect(await same.deploy(declare(baseline))).toEqual({ Baseline: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a change is a NEW version: draft cloned from production, edited, published, promoted; the old one is kept', async () => {
  const fake = startFakePolicyLitellm();
  const same = stack(fake);
  await same.deploy(declare(baseline));
  const before = fake.requests().length;
  expect(await same.deploy(declare({ ...baseline, guardrailsAdd: ['fake-pii'] }))).toEqual({
    Baseline: 'update',
  });
  expect(writesOf(fake.requests().slice(before))).toEqual([
    'POST /policies/name/FAKE-baseline/versions',
    'PUT /policies/FAKE-policy-0002',
    'PUT /policies/FAKE-policy-0002/status',
    'PUT /policies/FAKE-policy-0002/status',
  ]);
  expect(fake.bodies().slice(-3)).toEqual([
    { guardrails_add: ['fake-pii'] },
    { version_status: 'published' },
    { version_status: 'production' },
  ]);
  // ★ history: version 1 was demoted to published, version 2 is the enforced one
  expect(statuses(fake)).toEqual(['1:published', '2:production']);
  expect(await same.deploy(declare({ ...baseline, guardrailsAdd: ['fake-pii'] }))).toEqual({
    Baseline: 'noop',
  });
});

test('an undeclared field is carried by the clone, never sent: the description survives a guardrail change', async () => {
  const seed = policyRow({
    description: 'written by a person',
    guardrails_add: ['fake-pii'],
    inherit: 'FAKE-parent',
    policy_id: 'FAKE-live-1',
    policy_name: 'FAKE-baseline',
  });
  const fake = startFakePolicyLitellm({ seed: [seed] });
  await stack(fake).deploy(
    declare({ guardrailsAdd: ['fake-pii', 'fake-toxic'], policyName: 'FAKE-baseline' }),
    {
      adopt: true,
    },
  );
  const production = fake.versions().find((row) => row['version_status'] === 'production');
  expect(production).toMatchObject({
    description: 'written by a person',
    guardrails_add: ['fake-pii', 'fake-toxic'],
    inherit: 'FAKE-parent',
  });
  // ★ the edit body (third from last, before publish and promote) names only the field that differs
  expect(fake.bodies().at(-3)).toEqual({ guardrails_add: ['fake-pii', 'fake-toxic'] });
});

test('a live production policy is Unowned: refused without --adopt, adopted by name with it, and a match writes nothing', async () => {
  const seed = policyRow({
    description: 'FAKE baseline',
    guardrails_add: ['fake-injection', 'fake-pii'],
    policy_id: 'FAKE-live-2',
    policy_name: 'FAKE-baseline',
  });
  const fake = startFakePolicyLitellm({ seed: [seed] });
  const engine = stack(fake);
  await expect(engine.deploy(declare(baseline))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(Object.values(await engine.deploy(declare(baseline), { adopt: true }))).toEqual([
    'adopted',
  ]);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('a name that belongs to a config.yaml policy is refused, so a DB policy never shadows it by accident', async () => {
  const fake = startFakePolicyLitellm({ configPolicies: ['FAKE-baseline'] });
  await expect(stack(fake).deploy(declare(baseline))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
});

test('versions with no production one are refused, not guessed at', async () => {
  const demoted = policyRow({
    policy_id: 'FAKE-live-3',
    policy_name: 'FAKE-baseline',
    version_status: 'published',
  });
  const fake = startFakePolicyLitellm({ seed: [demoted] });
  await expect(stack(fake).deploy(declare(baseline))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
});

test('a different policy name is a replace, create-first, and the old policy is retained', async () => {
  const fake = startFakePolicyLitellm();
  const same = stack(fake);
  await same.deploy(declare(baseline));
  expect(await same.deploy(declare({ ...baseline, policyName: 'FAKE-other' }))).toEqual({
    Baseline: 'replace',
  });
  expect(fake.versions().map((row) => row['policy_name'])).toEqual(['FAKE-baseline', 'FAKE-other']);
});

test('a proxy that drops an empty-list edit fails the deploy instead of claiming success', async () => {
  // ⚠️ the fake's own model of a truthiness check on the edit route — unmeasured at 1.103.0
  const fake = startFakePolicyLitellm({ editIgnoresEmpty: true });
  const same = stack(fake);
  await same.deploy(declare(baseline));
  await expect(same.deploy(declare({ ...baseline, guardrailsAdd: [] }))).rejects.toThrow();
});

test('a refused declaration fails the plan before a single request', async () => {
  for (const props of [
    { ...baseline, policyName: ' ' },
    { ...baseline, description: ' ' },
    { ...baseline, inherit: 'FAKE-baseline' },
    { ...baseline, guardrailsAdd: ['a', 'a'] },
    { ...baseline, guardrailsAdd: ['a'], guardrailsRemove: ['a'] },
    { ...baseline, conditionModel: '' },
  ]) {
    const fake = startFakePolicyLitellm();
    await expect(stack(fake).deploy(declare(props))).rejects.toThrow();
    expect(fake.requests()).toEqual([]);
  }
});

test('removing the declaration RETAINS every version', async () => {
  const fake = startFakePolicyLitellm();
  const same = stack(fake);
  await same.deploy(declare(baseline));
  await same.deploy(Effect.void);
  expect(fake.versions()).toHaveLength(1);
});

test('delete removes EVERY version by name and is idempotent (LiteLLM answers 200 either way)', async () => {
  const fake = startFakePolicyLitellm();
  const same = stack(fake);
  await same.deploy(declare(baseline));
  await same.deploy(declare({ ...baseline, guardrailsAdd: ['fake-pii'] }));
  expect(fake.versions()).toHaveLength(2);
  const run = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fake.fetch)),
        Effect.provide(credentials({ apiKey: FAKE_KEY, baseUrl: FAKE_BASE })),
      ) as Effect.Effect<A, E, never>,
    );
  const output = {
    conditionModel: null,
    description: null,
    guardrailsAdd: [],
    guardrailsRemove: [],
    inherit: null,
    policyId: 'x',
    policyName: 'FAKE-baseline',
    versionNumber: 2,
  };
  await run(policyHandlers.delete({ output }));
  expect(fake.versions()).toEqual([]);
  await run(policyHandlers.delete({ output }));
});
