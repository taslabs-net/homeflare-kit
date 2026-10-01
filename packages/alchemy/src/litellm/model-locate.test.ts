/**
 * Which live row a `LiteLLM.Model` declaration means — `model-locate.ts`'s rules, through
 * Alchemy's real Plan and Apply over the fake proxy (`fake-model-litellm.ts`): a shared group
 * name is refused rather than guessed at, a pinned `id` selects exactly one row, a rename is a
 * new group unless the id is pinned, and a changed id is a replace.
 *
 * ★ EVERY VALUE IS `FAKE-*`; no environment variable is set anywhere (model.test.ts's header).
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

test('two live rows with the declared name are refused, never guessed at', async () => {
  const seed = [
    modelRow({
      litellm_params: { model: 'xai/grok-4.7' },
      model_info: { access_groups: [], id: 'FAKE-live-id-a' },
      model_name: 'grok',
    }),
    modelRow({
      litellm_params: { model: 'xai/grok-4.7' },
      model_info: { access_groups: [], id: 'FAKE-live-id-b' },
      model_name: 'grok',
    }),
  ];
  const fake = startFakeModelLitellm({ masterKey: KEY, seed });
  await expect(stack(fake).deploy(declare(grok), { adopt: true })).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
});

test('a declared id pins one of two same-named rows', async () => {
  const fake = startFakeModelLitellm({
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: { model: 'xai/grok-4.7' },
        model_info: { access_groups: [], id: 'FAKE-live-id-a' },
        model_name: 'grok',
      }),
      modelRow({
        litellm_params: { model: 'xai/grok-4.7' },
        model_info: { access_groups: [], id: 'FAKE-live-id-b' },
        model_name: 'grok',
      }),
    ],
  });
  const pinned: ModelProps = { ...grok, id: 'FAKE-live-id-b' };
  expect(await stack(fake).deploy(declare(pinned), { adopt: true })).toEqual({ Grok: 'adopted' });
  // The pin's declaration manages a credential the read never shows, so adopt converges it with
  // one params PATCH (the five nulls keep unmanaged flags — model-form.ts). The sibling with the
  // same group name is left alone: the adopted row is the one the id named.
  expect(writesOf(fake.requests())).toContain('PATCH /model/FAKE-live-id-b/update');
  expect(fake.models().map((row) => (row['model_info'] as Row)['id'])).toEqual([
    'FAKE-live-id-a',
    'FAKE-live-id-b',
  ]);
});

test('a renamed group without a pinned id is a new group: the old row is retained', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(grok));
  const planned = await same.deploy(declare({ ...grok, modelName: 'grok-fast' }));
  expect(planned).toEqual({ Grok: 'replace' });
  // ★ `defaultRemovalPolicy: 'retain'`: nothing removes the old group unless the stack opts in
  expect(fake.models().map((row) => row['model_name'])).toEqual(['grok', 'grok-fast']);
  const ids = fake.models().map((row) => String((row['model_info'] as Row)['id']));
  expect(ids[0]).not.toBe(ids[1]);
});

test('a rename with a pinned id renames the same row', async () => {
  const fake = startFakeModelLitellm({
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: { model: 'xai/grok-4.7' },
        model_info: { access_groups: [], id: 'FAKE-live-id' },
        model_name: 'grok',
      }),
    ],
  });
  const engine = stack(fake);
  const pinned: ModelProps = { ...grok, id: 'FAKE-live-id' };
  await engine.deploy(declare(pinned), { adopt: true });
  expect(
    await engine.deploy(declare({ ...pinned, modelName: 'grok-fast' }), { adopt: true }),
  ).toEqual({
    Grok: 'update',
  });
  expect(fake.models()).toHaveLength(1);
  expect(fake.models()[0]?.['model_name']).toBe('grok-fast');
  expect(fake.bodies().at(-1)).toMatchObject({
    model_info: { id: 'FAKE-live-id' },
    model_name: 'grok-fast',
  });
});

test('a changed declared id is a replace, create-first, and the old row is retained', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare({ ...grok, id: 'FAKE-id-a' }));
  const planned = await same.deploy(declare({ ...grok, id: 'FAKE-id-b' }));
  expect(planned).toEqual({ Grok: 'replace' });
  expect(fake.models().map((row) => String((row['model_info'] as Row)['id']))).toEqual([
    'FAKE-id-a',
    'FAKE-id-b',
  ]);
});
