/**
 * A replace (an unpinned rename, or a changed declared id) reaches `reconcile` with `output`
 * undefined and a live row under the name or id it is moving onto — and that row may belong to
 * another owner. The old gate let it take the row over (measured live on a throwaway 1.103.0
 * proxy through Alchemy's real Plan and Apply: the foreign row's model was overwritten, its
 * access group cleared, its `extra_headers` dropped, and state recorded the foreign id, so a
 * later destroy deleted another owner's deployment). The gate in model.ts now counts only a row
 * whose id is the deterministic one this declaration would create (`ours`); anything else is
 * refused (`LitellmModelForeignRowError`), and a declared id that points at an existing row goes
 * through the `Unowned`/`--adopt` gate like any adoption.
 *
 * ★ EVERY VALUE IS `FAKE-*`, through Alchemy's real Plan and Apply over the fake proxy.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { type FakeModelLitellm, modelRow, startFakeModelLitellm } from './fake-model-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMModel } from './model.ts';
import type { ModelProps } from './model-types.ts';

type Row = Record<string, unknown>;

const KEY = 'sk-test-master';
const stack = (fake: FakeModelLitellm) =>
  fakeStack({ apiKey: KEY, baseUrl: 'https://litellm.example.com' }, fake.fetch);
const declare = (props: ModelProps, name = 'Grok') =>
  Effect.gen(function* () {
    yield* LiteLLMModel(name, props);
  });

const grok: ModelProps = {
  apiKey: { fromEnv: 'FAKE_XAI_KEY' },
  model: 'xai/grok-4.7',
  modelName: 'grok',
};

/** A one-deployment group a foreign owner runs: a gateway auth header, a weight, a group. */
const foreign = modelRow({
  litellm_params: {
    extra_headers: { 'X-Gateway-Auth': 'FAKE-gateway-credential' },
    model: 'xai/grok-4.6',
    weight: 2,
  },
  model_info: { access_groups: ['FAKE-team'], id: 'FAKE-foreign-id' },
  model_name: 'grok',
});

const rowAt = (fake: FakeModelLitellm, id: string): Row =>
  (fake.models().find((each) => ((each['model_info'] as Row)['id'] as string) === id) ?? {}) as Row;

test('an unpinned rename onto a foreign row is refused and the row is untouched', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY, seed: [foreign] });
  const engine = stack(fake);
  // The stack first owns a row under another name, so the next declaration is a REPLACE.
  expect(await engine.deploy(declare({ ...grok, modelName: 'old-name' }))).toEqual({
    Grok: 'create',
  });
  const before = fake.requests().length;
  await expect(engine.deploy(declare(grok))).rejects.toThrow(/--adopt does not cover/);
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
  // 🔴 the measured takeover wrote the model, cleared the group and dropped extra_headers here.
  expect(rowAt(fake, 'FAKE-foreign-id')).toMatchObject({
    litellm_params: {
      extra_headers: { 'X-Gateway-Auth': 'FAKE-gateway-credential' },
      model: 'xai/grok-4.6',
      weight: 2,
    },
    model_info: { access_groups: ['FAKE-team'] },
    model_name: 'grok',
  });
  // The rename refused, the stack's own row is neither deleted nor renamed either.
  expect(writesOf(fake.requests())).toEqual(['POST /model/new']);
});

test('an unpinned rename onto a foreign row is refused even with --adopt', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY, seed: [foreign] });
  const engine = stack(fake);
  await engine.deploy(declare({ ...grok, modelName: 'old-name' }));
  const before = fake.requests().length;
  // 🔴 A replace's new identity is never probed and never offered adoption: Apply commits it as
  //   `replacing`, so `--adopt` cannot speak for it (ownership/adopt.ts). Refused, not adopted.
  await expect(engine.deploy(declare(grok), { adopt: true })).rejects.toThrow(
    /--adopt does not cover/,
  );
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('reverting an unpinned rename that hit a foreign row names a state recovery', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY, seed: [foreign] });
  const engine = stack(fake);
  expect(await engine.deploy(declare({ ...grok, modelName: 'old-name' }))).toEqual({
    Grok: 'create',
  });
  // The refusal is right, and Apply has already committed the `replacing` row.
  await expect(engine.deploy(declare(grok))).rejects.toThrow(/--adopt does not cover/);
  const before = fake.requests().length;
  // The engine resumes that same replacement. Reconcile finds the stack's own serving row by
  // the old name. Its id is the previous generation's, not this instance's physical name.
  await expect(engine.deploy(declare({ ...grok, modelName: 'old-name' }))).rejects.toThrow(
    /older generation/,
  );
  await expect(
    engine.deploy(declare({ ...grok, modelName: 'old-name' }), { adopt: true }),
  ).rejects.toThrow(/alchemy state rm/);
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
  expect(rowAt(fake, 'FAKE-foreign-id')).toMatchObject({
    litellm_params: { model: 'xai/grok-4.6' },
    model_name: 'grok',
  });
  const serving = fake.models().find((row) => row['model_name'] === 'old-name');
  if (serving === undefined) throw new Error("the stack's own row is gone");
  expect((serving['model_info'] as Row)['id']).not.toBe('FAKE-foreign-id');
});

test('a changed declared id pointing at a foreign row is refused, the row untouched', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY, seed: [foreign] });
  const engine = stack(fake);
  expect(
    await engine.deploy(declare({ ...grok, id: 'FAKE-ours-id', modelName: 'old-name' })),
  ).toEqual({ Grok: 'create' });
  const before = fake.requests().length;
  // The id is identity: declaring the foreign row's id is a replace onto it — refused, whether
  // it is `--adopt` or not, because the probe never asked whose row the replacement would move to.
  await expect(
    engine.deploy(declare({ ...grok, id: 'FAKE-foreign-id', modelName: 'old-name' }), {
      adopt: true,
    }),
  ).rejects.toThrow(/FAKE-foreign-id/);
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
  expect(rowAt(fake, 'FAKE-foreign-id')).toMatchObject({
    model_info: { access_groups: ['FAKE-team'] },
  });
  // The stack's own row survives the failed replace (`retain`), and the foreign row is intact.
  expect(rowAt(fake, 'FAKE-ours-id')).toMatchObject({ model_name: 'old-name' });
});

test('a declared id on a foreign row goes through the Unowned gate: refused, then adopted', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY, seed: [foreign] });
  const engine = stack(fake);
  // No state at all: the plan's probe answers Unowned, so the deploy refuses without --adopt.
  await expect(engine.deploy(declare({ ...grok, id: 'FAKE-foreign-id' }))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  // With --adopt it is an explicit adoption: the drift (a different model) PATCHes with the
  // row's own id in model_info, and the second deploy is a no-op on it.
  expect(await engine.deploy(declare({ ...grok, id: 'FAKE-foreign-id' }), { adopt: true })).toEqual(
    { Grok: 'adopted' },
  );
  expect(writesOf(fake.requests())).toEqual(['PATCH /model/FAKE-foreign-id/update']);
  const adopted = rowAt(fake, 'FAKE-foreign-id');
  expect(adopted['litellm_params']).toMatchObject({ model: 'xai/grok-4.7' });
  expect(adopted['model_info']).toMatchObject({ access_groups: [] });
  expect(await engine.deploy(declare({ ...grok, id: 'FAKE-foreign-id' }), { adopt: true })).toEqual(
    { Grok: 'noop' },
  );
});

test('a config-file row is refused at adopt, even with --adopt', async () => {
  const config = modelRow({
    litellm_params: { model: 'xai/grok-4.6' },
    model_info: { access_groups: ['FAKE-team'], db_model: false, id: 'FAKE-config-id' },
    model_name: 'grok',
  });
  const fake = startFakeModelLitellm({ masterKey: KEY, seed: [config] });
  const engine = stack(fake);
  // The DB API cannot manage what the proxy serves from its config file, so --adopt must not
  // take it over either: the gate refuses before a single write.
  await expect(engine.deploy(declare(grok), { adopt: true })).rejects.toThrow(/config file/);
  expect(writesOf(fake.requests())).toEqual([]);
  expect(rowAt(fake, 'FAKE-config-id')).toMatchObject({
    model_info: { access_groups: ['FAKE-team'], db_model: false },
    model_name: 'grok',
  });
});
