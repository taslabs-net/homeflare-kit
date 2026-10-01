/**
 * `LiteLLM.Model`'s pure form, with no server and no environment: the plan-time refusals, the wire
 * bodies, the read shape under encryption, and the comparison. The credential is a reference, so
 * nothing here reads (or could read) a value.
 */
import { describe, expect, test } from 'bun:test';
import { declaredValues, sealFromValues, sealState } from './model-credential.ts';
import {
  createBody,
  declaredDigest,
  differing,
  firstProblem,
  patchBody,
  toAttributes,
} from './model-form.ts';
import type { ModelProps } from './model-types.ts';

type Row = Record<string, unknown>;

const props: ModelProps = {
  apiKey: { fromEnv: 'FAKE_XAI_KEY' },
  model: 'xai/grok-4.7',
  modelName: 'grok',
};

describe('firstProblem refuses', () => {
  test('a blank or padded model name', () => {
    expect(firstProblem({ ...props, modelName: '' })).toContain('modelName');
    expect(firstProblem({ ...props, modelName: ' grok' })).toContain('modelName');
  });

  test('a blank id', () => {
    expect(firstProblem({ ...props, id: '  ' })).toContain('id');
  });

  test('a model without a provider prefix', () => {
    expect(firstProblem({ ...props, model: 'grok-4.7' })).toContain('provider prefix');
  });

  test('the openai/ prefix on a grok-named group: Grok is xAI', () => {
    expect(firstProblem({ ...props, model: 'openai/grok-4.7' })).toContain('xAI');
  });

  test('an api_base that carries a secret, a userinfo or a fragment', () => {
    expect(firstProblem({ ...props, apiBase: 'https://api.xai.example.com?token=FAKE' })).toContain(
      'credential',
    );
    expect(firstProblem({ ...props, apiBase: 'https://user:FAKE@api.xai.example.com' })).toContain(
      'userinfo',
    );
    expect(firstProblem({ ...props, apiBase: 'https://api.xai.example.com#frag' })).toContain(
      'fragment',
    );
  });

  test('an apiKey value instead of a reference', () => {
    expect(firstProblem({ ...props, apiKey: 'FAKE-literal-value' as never })).toContain(
      'never a value',
    );
    expect(firstProblem({ ...props, apiKey: { fromEnv: '' } })).toContain('environment variable');
  });

  test('nothing else: a well-formed declaration passes', () => {
    expect(firstProblem(props)).toBeUndefined();
    expect(
      firstProblem({
        apiBase: 'https://api.xai.example.com',
        baseModel: 'grok-4',
        id: 'FAKE-id',
        mode: 'chat',
        model: 'cloudflare/@cf/meta/llama-3.1-8b-instruct',
        modelName: 'llama',
      }),
    ).toBeUndefined();
  });
});

describe('the wire bodies', () => {
  test('a create sends the group, the id it asks for, and the reference credential', () => {
    // `as Row`: the SDK's 1.103.0 request type does not declare `access_groups` (model-form.ts)
    expect(createBody(props, 'FAKE-wanted') as unknown as Row).toEqual({
      litellm_params: { api_key: 'os.environ/FAKE_XAI_KEY', model: 'xai/grok-4.7' },
      model_info: { access_groups: [], id: 'FAKE-wanted' },
      model_name: 'grok',
    });
  });

  test('a declared api_base, mode, base model and groups are sent', () => {
    const declared: ModelProps = {
      accessGroups: ['FAKE-team'],
      apiBase: 'https://api.xai.example.com',
      baseModel: 'grok-4',
      mode: 'chat',
      model: 'xai/grok-4.7',
      modelName: 'grok',
    };
    expect(createBody(declared, 'FAKE-wanted')).toMatchObject({
      litellm_params: { api_base: 'https://api.xai.example.com' },
      model_info: {
        access_groups: ['FAKE-team'],
        base_model: 'grok-4',
        mode: 'chat',
      },
    });
  });

  test('a patch re-sends the managed set, the row id, and the group name only when it changed', () => {
    const live = toAttributes({
      litellm_params: { model: 'xai/grok-4.7' },
      model_info: { id: 'FAKE-live-id' },
      model_name: 'grok',
    });
    const sameName = patchBody(props, live) as Row;
    expect(sameName['litellm_params']).toEqual({
      allow_client_keepalive_override: null,
      api_key: 'os.environ/FAKE_XAI_KEY',
      merge_reasoning_content_in_choices: null,
      model: 'xai/grok-4.7',
      use_in_pass_through: null,
      use_litellm_proxy: null,
      use_xai_oauth: null,
    });
    expect('model_name' in sameName).toBe(false);
    // ★ The row's own id rides the body: an adopt-by-id re-affirms the row it pinned.
    expect(sameName['model_info']).toEqual({ access_groups: [], id: 'FAKE-live-id' });
    expect(sameName['model_id']).toBe('FAKE-live-id');

    const renamed = patchBody({ ...props, modelName: 'grok-fast' }, live) as Row;
    expect(renamed['model_name']).toBe('grok-fast');
  });

  test('an undeclared mode, base model and credential are never sent, so the row keeps its own', () => {
    const live = toAttributes({
      litellm_params: { model: 'xai/grok-4.7' },
      model_info: { id: 'FAKE-live-id' },
      model_name: 'grok',
    });
    const bare: ModelProps = { model: 'xai/grok-4.7', modelName: 'grok' };
    const body = patchBody(bare, live) as Row;
    expect(body['litellm_params']).toMatchObject({
      model: 'xai/grok-4.7',
      use_in_pass_through: null,
      use_xai_oauth: null,
    });
    expect(body['model_info']).toEqual({ access_groups: [], id: 'FAKE-live-id' });
    expect((patchBody({ ...bare, mode: 'chat' }, live) as Row)['model_info']).toEqual({
      access_groups: [],
      id: 'FAKE-live-id',
      mode: 'chat',
    });
  });
});

describe('the declared seal', () => {
  test('matches what a write stamps, and round-trips', () => {
    const sealed = sealFromValues(declaredValues(props));
    expect(sealed).not.toBe('');
    expect(sealState(props, sealed)).toBe('match');
  });

  test('an adopted row without a seal is stale, so the next reconcile records it locally', () => {
    expect(sealState(props, '')).toBe('stale');
  });

  test('a change of model, api_base or reference NAME moves the seal (the value never does)', () => {
    const sealed = declaredDigest(props);
    expect(sealState({ ...props, model: 'xai/grok-4.6' }, sealed)).toBe('stale');
    expect(sealState({ ...props, apiBase: 'https://api.xai.example.com' }, sealed)).toBe('stale');
    expect(sealState({ ...props, apiKey: { fromEnv: 'FAKE_XAI_KEY_TWO' } }, sealed)).toBe('stale');
    expect(sealState(props, 'garbage')).toBe('stale');
  });
});

describe('toAttributes and differing', () => {
  test('reads the id from wherever the proxy carried it', () => {
    expect(toAttributes({ model_info: { id: 'i' }, model_name: 'grok' }).id).toBe('i');
    expect(toAttributes({ id: 'top', model_name: 'grok' }).id).toBe('top');
  });

  test('a ciphertext params field hides the model; an object one carries it as it is', () => {
    const encrypted = toAttributes({
      litellm_params: '<encrypted>',
      model_name: 'grok',
    });
    expect(encrypted.model).toBeNull();
    expect(differing(encrypted, props)).toEqual([]);
    const visible = toAttributes({
      litellm_params: { model: 'xai/grok-4.7' },
      model_name: 'grok',
    });
    expect(visible.model).toBe('xai/grok-4.7');
  });

  test('never copies api_base or api_key, and no row supplies a digest', () => {
    const live = toAttributes({
      litellm_params: {
        api_base: 'https://api.xai.example.com',
        api_key: 'os.environ/FAKE_XAI_KEY',
        model: 'xai/grok-4.7',
      },
      model_info: { id: 'i' },
      model_name: 'grok',
    });
    expect(JSON.stringify(live)).not.toContain('FAKE_XAI_KEY');
    expect(live.paramsSeal).toBe('');
  });

  test('names exactly the fields where the row and the declaration disagree', () => {
    const live = toAttributes({
      litellm_params: { model: 'xai/grok-4.7' },
      model_info: { access_groups: ['FAKE-team'], id: 'i', mode: 'chat' },
      model_name: 'grok',
    });
    expect(differing(live, props)).toEqual(['access_groups']);
    expect(differing(live, { ...props, mode: 'chat' })).toEqual(['access_groups']);
    expect(differing(live, { ...props, accessGroups: ['FAKE-team'], mode: 'chat' })).toEqual([]);
    expect(differing(live, { ...props, modelName: 'grok-fast' })).toEqual([
      'model_name',
      'access_groups',
    ]);
    // ★ access groups compare as a set, order-free
    const shuffled = toAttributes({
      model_info: { access_groups: ['b', 'a'], id: 'i' },
      model_name: 'grok',
    });
    expect(differing(shuffled, { ...props, accessGroups: ['a', 'b'] })).toEqual([]);
  });
});
