/**
 * Adopt and a later params write must not clobber `litellm_params` this resource does not own.
 *
 * ⚠️ `fillsParamDefaults` models v1.103.0 `updateLiteLLMParams` plus `update_model`'s merge
 *   (`model_management_endpoints.py`): the parsed model fills every unset field, a non-`None`
 *   default (`false`) overwrites the stored value, and a key the model does not declare is
 *   dropped. The plain fake merge hides that, so this file is what pins it.
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
  expect(writesOf(fake.requests())).not.toContain('POST /model/update');
  expect(fake.models()[0]?.['litellm_params']).toEqual(liveParams);
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
  const posted = fake.bodies().find((body) => body['litellm_params'] !== undefined);
  const sent = posted?.['litellm_params'] as Row;
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
