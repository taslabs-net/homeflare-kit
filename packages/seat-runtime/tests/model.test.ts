/**
 * SeatModel against the stub: a completion, a tool round and an embedding, and what each
 * put on the wire — the bearer key, the LiteLLM tag header, the cache and retry fields.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Effect, Redacted } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { SeatModel } from '../src/index.ts';
import { API_KEY, type ScenarioResult, TAGS, runScenario } from './scenario.ts';
import { type Stub, startStub } from './stub.ts';

let stub: Stub;
let result: ScenarioResult;

beforeAll(async () => {
  stub = startStub();
  result = await runScenario(stub);
});
afterAll(() => stub.stop());

const bodyOf = (path: string, index: number) => stub.at(path)[index]?.json ?? {};

describe('language model', () => {
  test('a plain completion returns the stub’s text', () => {
    expect(result.text).toBe('pong');
  });

  test('a tool round: one call, one handler result, then a follow-up carrying it', () => {
    expect(result.round1).toEqual({ calls: 1, results: 1, finish: 'tool-calls' });
    expect(result.round2).toEqual({ text: 'pong', finish: 'stop' });

    const chat = stub.at('/v1/chat/completions');
    // ping, the tool turn, its follow-up.
    expect(chat).toHaveLength(3);
    const followUp = (bodyOf('/v1/chat/completions', 2)['messages'] ?? []) as {
      role: string;
      content: unknown;
    }[];
    const toolMessage = followUp.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage?.content)).toContain('fact:a');
  });

  test('the tool schema goes out with strict JSON schema OFF', () => {
    // ★ Measured 2026-09-29: compat's own default sends `strict: true` on the same tool.
    const tools = (bodyOf('/v1/chat/completions', 1)['tools'] ?? []) as {
      function: { name: string; strict?: unknown };
    }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.function.name).toBe('read_fact');
    expect(tools[0]?.function.strict).toBe(false);
  });
});

describe('embedding model', () => {
  test('embeds one input and reports the declared dimensions', () => {
    expect(result.embedding).toEqual({ dims: 3, declared: 3 });
  });

  test('the declared dimensions are not sent to LiteLLM', () => {
    // ⚠️ compat's own `model(name, { dimensions })` would put it in the body.
    const body = bodyOf('/v1/embeddings', 0);
    expect(body['model']).toBe('embeddings');
    expect('dimensions' in body).toBe(false);
  });

  test('a trailing slash on apiUrl does not double up', () => {
    // The scenario passes `${origin}/v1/`; the stub only answers `/v1/embeddings`.
    expect(stub.at('/v1/embeddings')).toHaveLength(1);
  });
});

describe('what every model call carries', () => {
  test('the bearer key, the tags header, no cache, no retries, the metadata', () => {
    for (const request of [...stub.at('/v1/chat/completions'), ...stub.at('/v1/embeddings')]) {
      expect(request.headers['authorization']).toBe(`Bearer ${API_KEY}`);
      expect(request.headers['x-litellm-tags']).toBe(TAGS.join(','));
      expect(request.headers['cache-control']).toBe('no-cache, no-store');
      expect(request.json?.['cache']).toEqual({ 'no-cache': true, 'no-store': true });
      expect(request.json?.['num_retries']).toBe(0);
      expect(request.json?.['metadata']).toEqual({ seat: 'cf-coding' });
    }
  });
});

describe('options', () => {
  test('a Redacted key is used as given, and noCache: false leaves the cache alone', async () => {
    const own = startStub();
    const model = SeatModel.layer({
      model: 'cf-code',
      apiUrl: `${own.origin}/v1`,
      apiKey: Redacted.make('sk-already-redacted'),
      tags: 'host:ct100,seat:x',
      noCache: false,
    });
    await Effect.runPromise(
      LanguageModel.generateText({ prompt: 'p' }).pipe(Effect.provide(model)),
    );
    own.stop();
    const call = own.at('/v1/chat/completions')[0];
    expect(call?.headers['authorization']).toBe('Bearer sk-already-redacted');
    expect(call?.headers['x-litellm-tags']).toBe('host:ct100,seat:x');
    expect(call?.headers['cache-control']).toBeUndefined();
    expect(call?.json?.['cache']).toBeUndefined();
    expect(call?.json?.['num_retries']).toBe(0);
  });

  test('a bad tag fails when the layer is built, not on the first request', () => {
    const options = { model: 'm', apiUrl: 'http://127.0.0.1:1/v1', apiKey: 'k' };
    expect(() => SeatModel.layer({ ...options, tags: ['has space'] })).toThrow(/not a tag/);
    expect(() => SeatModel.layer({ ...options, tags: [] })).toThrow(/at least one/);
  });
});
