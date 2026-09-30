/**
 * `LiteLLM.Model` through Alchemy's real Plan and Apply over the fake proxy
 * (`fake-model-litellm.ts`): create, no-op, adopt and its stamping write, pinning, rename, drift.
 *
 * ★ EVERY VALUE IS `FAKE-*`. No environment variable is set anywhere: the resource sends
 *   LiteLLM's own reference form and never reads `process.env` (model-credential.ts), so there is
 *   no value to set and no value to leak — the test asserts exactly that.
 * ⚠️ WHAT THE FAKE MODELS IS ITS OWN CHOICE, NOT A MEASUREMENT OF LITELLM 1.103.0 (see the fake).
 *   A test that leans on one of those choices says so.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeModelLitellm, modelRow, startFakeModelLitellm } from './fake-model-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMModel } from './model.ts';
import type { ModelProps } from './model-types.ts';

type Row = Record<string, unknown>;

const KEY = 'sk-test-master';
const stack = (fake: FakeModelLitellm) =>
  fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: ModelProps, name = 'Grok') =>
  Effect.gen(function* () {
    yield* LiteLLMModel(name, props);
  });

const grok: ModelProps = {
  apiKey: { fromEnv: 'FAKE_XAI_KEY' },
  model: 'xai/grok-4.7',
  modelName: 'grok',
};

test('creates a deployment that carries the reference credential, never a value', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  expect(await stack(fake).deploy(declare(grok))).toEqual({ Grok: 'create' });
  expect(fake.bodies()[0]).toMatchObject({
    litellm_params: { api_key: 'os.environ/FAKE_XAI_KEY', model: 'xai/grok-4.7' },
    model_info: { access_groups: [] },
    model_name: 'grok',
  });
  // ★ a deterministic physical name, not a proxy-issued uuid
  expect(String((fake.models()[0]?.['model_info'] as Row | undefined)?.['id'])).toMatch(
    /^[a-z0-9-]+$/,
  );
});

test('a second deploy of the same declaration writes nothing', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(grok));
  const before = fake.requests().length;
  expect(await same.deploy(declare(grok))).toEqual({ Grok: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a different environment NAME moves the reference; the value is never read', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(grok));
  const moved = { ...grok, apiKey: { fromEnv: 'FAKE_XAI_KEY_TWO' } };
  expect(await same.deploy(declare(moved))).toEqual({ Grok: 'update' });
  expect(fake.models()[0]?.['litellm_params']).toMatchObject({
    api_key: 'os.environ/FAKE_XAI_KEY_TWO',
  });
  expect(await same.deploy(declare(moved))).toEqual({ Grok: 'noop' });
});

test('removing a declared api_base leaves the live row its own base', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  const same = stack(fake);
  const withBase = { ...grok, apiBase: 'https://api.xai.example.com' };
  await same.deploy(declare(withBase));
  // ★ the read cannot see api_base (it is never copied, model-form.ts), so it is the SEAL that
  //   notices the declaration changed — and the update deliberately sends no api_base.
  expect(await same.deploy(declare(grok))).toEqual({ Grok: 'update' });
  expect(fake.bodies().at(-1)?.['litellm_params']).toEqual({
    api_key: 'os.environ/FAKE_XAI_KEY',
    model: 'xai/grok-4.7',
  });
  expect(fake.models()[0]?.['litellm_params']).toMatchObject({
    api_base: 'https://api.xai.example.com',
  });
  expect(await same.deploy(declare(grok))).toEqual({ Grok: 'noop' });
});

test('a live row is Unowned: refused without --adopt, adopted with one stamping write', async () => {
  const fake = startFakeModelLitellm({
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: { model: 'xai/grok-4.7' },
        model_info: { access_groups: ['FAKE-team'], id: 'FAKE-live-id', mode: 'chat' },
        model_name: 'grok',
      }),
    ],
  });
  const adopted: ModelProps = {
    accessGroups: ['FAKE-team'],
    model: 'xai/grok-4.7',
    modelName: 'grok',
  };
  const engine = stack(fake);
  await expect(engine.deploy(declare(adopted))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  expect(await engine.deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'adopted' });
  // ★ one update stamps the declaration the row cannot prove (paramsSeal '' → stale), and it
  //   sends exactly the managed set: the row's undeclared mode and credential are left alone.
  expect(writesOf(fake.requests())).toEqual(['POST /model/update']);
  expect(fake.bodies()[0]).toEqual({
    litellm_params: { model: 'xai/grok-4.7' },
    model_info: { access_groups: ['FAKE-team'], id: 'FAKE-live-id' },
  });
  expect(fake.models()[0]?.['model_info'] as Row | undefined).toMatchObject({ mode: 'chat' });
  expect(await engine.deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'noop' });
});

test('adopting a row whose groups the declaration omits clears them', async () => {
  const fake = startFakeModelLitellm({
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: { model: 'xai/grok-4.7' },
        model_info: { access_groups: ['FAKE-team'], id: 'FAKE-live-id' },
        model_name: 'grok',
      }),
    ],
  });
  const adopted: ModelProps = { model: 'xai/grok-4.7', modelName: 'grok' };
  expect(await stack(fake).deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'adopted' });
  // ★ access_groups is always managed with a default empty set (model-types.ts)
  expect(fake.models()[0]?.['model_info'] as Row | undefined).toMatchObject({ access_groups: [] });
});

test('a proxy that drops an edit it cannot apply fails the deploy instead of claiming success', async () => {
  // ⚠️ the fake's own model of a truthiness check on the update route — unmeasured at 1.103.0
  const fake = startFakeModelLitellm({
    editIgnoresFalsy: true,
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: { model: 'xai/grok-4.7' },
        model_info: { access_groups: ['FAKE-team'], id: 'FAKE-live-id' },
        model_name: 'grok',
      }),
    ],
  });
  const adopted: ModelProps = { model: 'xai/grok-4.7', modelName: 'grok' };
  await expect(stack(fake).deploy(declare(adopted), { adopt: true })).rejects.toThrow();
});

test('an encrypted row is judged by the declared seal, never by the ciphertext', async () => {
  const fake = startFakeModelLitellm({ encryptParams: true, masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(grok));
  const before = fake.requests().length;
  expect(await same.deploy(declare(grok))).toEqual({ Grok: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a row the list omits is still adopted through the by-id read', async () => {
  const fake = startFakeModelLitellm({
    listOmits: ['FAKE-live-id'],
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: { model: 'xai/grok-4.7' },
        model_info: { access_groups: [], id: 'FAKE-live-id' },
        model_name: 'grok',
      }),
    ],
  });
  const pinned: ModelProps = { ...grok, id: 'FAKE-live-id' };
  expect(await stack(fake).deploy(declare(pinned), { adopt: true })).toEqual({ Grok: 'adopted' });
});

test('a declaration carrying a credential value is refused before a single request', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  await expect(
    stack(fake).deploy(declare({ ...grok, apiKey: 'FAKE-literal-value' as never })),
  ).rejects.toThrow();
  expect(fake.requests()).toEqual([]);
});
