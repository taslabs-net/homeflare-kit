/**
 * A deploy that dies after `POST /model/new` and before the read-back commits attributes.
 * The next plan resumes the same generation (`creating` or `replacing`, no attributes).
 *
 * ★ Through Alchemy's real Plan and Apply. `noRetry` so the injected 500 is the failure, not a
 *   backoff that then succeeds. Every value is `FAKE-*`.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeModelLitellm, startFakeModelLitellm } from './fake-model-litellm.ts';
import { fakeStack } from './fake-stack.ts';
import { LiteLLMModel } from './model.ts';
import type { ModelProps } from './model-types.ts';

const KEY = 'sk-test-master';
const stack = (fake: FakeModelLitellm) =>
  fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch, 'ModelStack', { noRetry: true });
const declare = (props: ModelProps) =>
  Effect.gen(function* () {
    yield* LiteLLMModel('Grok', props);
  });

const rowId = (row: Record<string, unknown>): string =>
  String((row['model_info'] as Record<string, unknown>)['id']);

test('an unpinned create interrupted after POST resumes on the next deploy', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  const engine = stack(fake);
  const props: ModelProps = { model: 'xai/grok-4.7', modelName: 'grok' };
  fake.failNextReadBacks(1);
  await expect(engine.deploy(declare(props))).rejects.toThrow(/injected read-back failure/);
  expect(fake.models()).toHaveLength(1);
  // The recovery read's instance id is the creating row's, so the physical name matches and the
  // row is ours. No --adopt.
  expect(await engine.deploy(declare(props))).toEqual({ Grok: 'create' });
  expect(await engine.deploy(declare(props))).toEqual({ Grok: 'noop' });
});

test('a declared-id replace whose read-back 500s resumes with --adopt', async () => {
  const fake = startFakeModelLitellm({ masterKey: KEY });
  const engine = stack(fake);
  const at = (id: string): ModelProps => ({ id, model: 'xai/grok-4.7', modelName: 'grok' });
  expect(await engine.deploy(declare(at('FAKE-id-a')))).toEqual({ Grok: 'create' });
  fake.failNextReadBacks(1);
  await expect(engine.deploy(declare(at('FAKE-id-b')))).rejects.toThrow(
    /injected read-back failure/,
  );
  expect(fake.models().map(rowId)).toContain('FAKE-id-b');
  // The row is this stack's own, posted before the read-back died. Without --adopt the resume
  // still refuses; with it, the unfinished generation may take the row it created.
  await expect(engine.deploy(declare(at('FAKE-id-b')))).rejects.toThrow(/--adopt/);
  expect(await engine.deploy(declare(at('FAKE-id-b')), { adopt: true })).toEqual({
    Grok: 'replace',
  });
  expect(await engine.deploy(declare(at('FAKE-id-b')), { adopt: true })).toEqual({ Grok: 'noop' });
});
