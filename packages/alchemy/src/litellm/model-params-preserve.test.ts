/**
 * Adopt and a later params write must not clobber `litellm_params` this resource does not own.
 *
 * ⚠️ `fillsParamDefaults` models v1.103.0 `updateLiteLLMParams`: the parsed model fills every
 *   unset field with its pydantic default before the write, a non-`None` default (`false`)
 *   overwrites the stored value, and JSON `null` is the `None` that keeps the stored value. The
 *   real PATCH route merges — sent keys land, the rest of the row survives — which is exactly
 *   what stops the write clobbering keys the declaration does not own. This file pins that.
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

const liveParams = {
  model: 'xai/grok-4.7',
  use_in_pass_through: true,
  use_xai_oauth: true,
  'FAKE-extra-param': 'kept',
};

test('adopting a matching row stamps the seal locally and leaves unmanaged params', async () => {
  const fake = startFakeModelLitellm({
    fillsParamDefaults: true,
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: liveParams,
        model_info: { access_groups: [], id: 'FAKE-live-id' },
        model_name: 'grok',
      }),
    ],
  });
  const adopted: ModelProps = { model: 'xai/grok-4.7', modelName: 'grok' };
  const engine = stack(fake);
  expect(await engine.deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'adopted' });
  expect(writesOf(fake.requests())).not.toContain('PATCH /model/FAKE-live-id/update');
  expect(fake.models()[0]?.['litellm_params']).toEqual(liveParams);
  expect(await engine.deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'noop' });
});

test('adopting a matching row still converges a DECLARED credential, flags intact', async () => {
  const fake = startFakeModelLitellm({
    fillsParamDefaults: true,
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: {
          model: 'xai/grok-4.7',
          api_key: 'os.environ/FAKE_OLD_KEY',
          use_in_pass_through: true,
        },
        model_info: { access_groups: [], id: 'FAKE-live-id' },
        model_name: 'grok',
      }),
    ],
  });
  // api_key is never on the read, so the row looks like a perfect match: only the declared
  // credential reference says otherwise, and only a write can converge it (model-form.ts).
  const adopted: ModelProps = {
    apiKey: { fromEnv: 'FAKE_NEW_KEY' },
    model: 'xai/grok-4.7',
    modelName: 'grok',
  };
  const engine = stack(fake);
  expect(await engine.deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'adopted' });
  expect(writesOf(fake.requests())).toContain('PATCH /model/FAKE-live-id/update');
  expect(fake.models()[0]?.['litellm_params']).toMatchObject({
    api_key: 'os.environ/FAKE_NEW_KEY',
    model: 'xai/grok-4.7',
    use_in_pass_through: true,
  });
  expect(await engine.deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'noop' });
});

test('a real params write sends null for the non-None defaults and keeps extra keys', async () => {
  const fake = startFakeModelLitellm({
    fillsParamDefaults: true,
    masterKey: KEY,
    seed: [
      modelRow({
        litellm_params: liveParams,
        model_info: { access_groups: [], id: 'FAKE-live-id' },
        model_name: 'grok',
      }),
    ],
  });
  const adopted: ModelProps = { model: 'xai/grok-4.6', modelName: 'grok' };
  expect(await stack(fake).deploy(declare(adopted), { adopt: true })).toEqual({ Grok: 'adopted' });
  const patched = fake.bodies().find((body) => body['litellm_params'] !== undefined);
  const sent = patched?.['litellm_params'] as Row;
  expect(sent['model']).toBe('xai/grok-4.6');
  expect(sent['use_in_pass_through']).toBeNull();
  expect(sent['use_litellm_proxy']).toBeNull();
  expect(sent['use_xai_oauth']).toBeNull();
  expect(sent['allow_client_keepalive_override']).toBeNull();
  expect(sent['merge_reasoning_content_in_choices']).toBeNull();
  expect(fake.models()[0]?.['litellm_params']).toMatchObject({
    'FAKE-extra-param': 'kept',
    model: 'xai/grok-4.6',
    use_in_pass_through: true,
    use_xai_oauth: true,
  });
});
