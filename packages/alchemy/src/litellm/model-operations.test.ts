/**
 * `LiteLLM.Model`'s operations against the fake proxy: what absence really is, and which delete
 * failures are allowed to be swallowed. The rule under test is S21's — never decide absence from
 * an error's text, only from a read.
 *
 * ⚠️ The fake's 400 on a delete of a missing id is its own choice, not a measurement of LiteLLM
 *   1.103.0. A PATCH of a missing id is the measured 404 (fake-model-litellm.ts).
 */
import { credentials } from '@distilled.cloud/litellm/Credentials';
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { FAKE_BASE } from './fake-litellm.ts';
import { modelRow, startFakeModelLitellm } from './fake-model-litellm.ts';
import { deleteModel, listModels, readModelRow } from './model-operations.ts';
import { LitellmModelUnreadableError } from './model-errors.ts';
import type { LitellmOpContext } from './operations.ts';

const KEY = 'sk-test-master';

const run = <A, E>(
  fetchFn: typeof globalThis.fetch,
  effect: Effect.Effect<A, E, LitellmOpContext>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

const live = modelRow({
  litellm_params: { model: 'xai/grok-4.7' },
  model_info: { access_groups: [], id: 'FAKE-live-id' },
  model_name: 'grok',
});

describe('absence', () => {
  test('a missing id is a 400, re-listed, and absent only when the list lacks it', async () => {
    const fake = startFakeModelLitellm({ masterKey: KEY });
    await expect(run(fake.fetch, readModelRow('FAKE-never-existed'))).resolves.toBeUndefined();
    expect(fake.requests().map((request) => request.path)).toEqual([
      '/model/info?litellm_model_id=FAKE-never-existed',
      '/model/info',
    ]);
  });

  test('a 400 on an id the list still holds is not read as absence', async () => {
    const fake = startFakeModelLitellm({
      byIdRefused: true,
      masterKey: KEY,
      seed: [live],
    });
    await expect(run(fake.fetch, readModelRow('FAKE-live-id'))).rejects.toThrow();
  });

  test('a row the by-id read answers is the one asked for', async () => {
    const fake = startFakeModelLitellm({ masterKey: KEY, seed: [live] });
    const row = await run(fake.fetch, readModelRow('FAKE-live-id'));
    expect(row?.id).toBe('FAKE-live-id');
  });

  test('a list answer without ids is refused, never adopted', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ data: [{ model_name: 'grok' }] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })) as unknown as typeof globalThis.fetch;
    const result = run(fetchFn, listModels());
    await expect(result).rejects.toBeInstanceOf(LitellmModelUnreadableError);
  });
});

describe('deleting a deployment', () => {
  test('a 400 on a row that is genuinely still live is not swallowed', async () => {
    const fake = startFakeModelLitellm({ forbidDelete: true, masterKey: KEY, seed: [live] });
    await expect(run(fake.fetch, deleteModel('FAKE-live-id'))).rejects.toThrow();
    expect(fake.models()).toHaveLength(1);
  });

  test('a genuinely-gone id still succeeds with no error (idempotent delete preserved)', async () => {
    const fake = startFakeModelLitellm({ forbidDelete: true, masterKey: KEY });
    await expect(run(fake.fetch, deleteModel('FAKE-never-existed'))).resolves.toBeUndefined();
  });

  test('a delete that lands removes the row', async () => {
    const fake = startFakeModelLitellm({ masterKey: KEY, seed: [live] });
    await expect(run(fake.fetch, deleteModel('FAKE-live-id'))).resolves.toBeUndefined();
    expect(fake.models()).toEqual([]);
  });
});
