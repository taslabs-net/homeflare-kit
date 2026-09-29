/**
 * The request stamp on its own: the headers, the body fields, and what it must leave alone.
 */
import { describe, expect, test } from 'bun:test';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat';
import { Effect, Layer, Redacted } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpBody from 'effect/unstable/http/HttpBody';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { joinTags, stampRequest } from '../src/stamp.ts';
import { startStub } from './stub.ts';

const post = (body: unknown) =>
  HttpClientRequest.post('http://127.0.0.1:4100/v1/chat/completions').pipe(
    HttpClientRequest.bodyJsonUnsafe(body),
  );

const bodyOf = (request: HttpClientRequest.HttpClientRequest): Record<string, unknown> =>
  request.body._tag === 'Uint8Array'
    ? (JSON.parse(new TextDecoder().decode(request.body.body)) as Record<string, unknown>)
    : {};

const stamp = { tags: 'host:ct100', noCache: true, metadata: undefined } as const;

describe('stampRequest', () => {
  test('sets the tag header, the cache controls and zero retries, keeping the body', () => {
    const out = stampRequest(post({ model: 'cf-code', messages: [] }), stamp);
    expect(out.headers['x-litellm-tags']).toBe('host:ct100');
    expect(out.headers['cache-control']).toBe('no-cache, no-store');
    expect(bodyOf(out)).toEqual({
      model: 'cf-code',
      messages: [],
      cache: { 'no-cache': true, 'no-store': true },
      num_retries: 0,
    });
  });

  test('noCache false leaves the cache alone but still forces zero retries', () => {
    const out = stampRequest(post({ model: 'm', cache: { ttl: 60 } }), {
      ...stamp,
      noCache: false,
    });
    expect(out.headers['cache-control']).toBeUndefined();
    expect(bodyOf(out)).toEqual({ model: 'm', cache: { ttl: 60 }, num_retries: 0 });
  });

  test('metadata is written only when the body carries none', () => {
    const metadata = { seat: 'cf-coding' };
    expect(bodyOf(stampRequest(post({ model: 'm' }), { ...stamp, metadata }))['metadata']).toEqual(
      metadata,
    );
    const own = { run: '1' };
    expect(
      bodyOf(stampRequest(post({ model: 'm', metadata: own }), { ...stamp, metadata }))['metadata'],
    ).toEqual(own);
  });

  test('a body of bytes, with no retained text, is still stamped', () => {
    // ⚠️ `HttpBody.text` is undefined for a body built from bytes; reading it alone would have
    //   made the stamp a silent no-op and left LiteLLM's cache on.
    const bytes = new TextEncoder().encode(JSON.stringify({ model: 'm' }));
    const request = HttpClientRequest.post('http://x.test/v1').pipe(
      HttpClientRequest.setBody(HttpBody.uint8Array(bytes, 'application/json')),
    );
    expect(bodyOf(stampRequest(request, stamp))['num_retries']).toBe(0);
  });

  test('leaves a non-JSON, an invalid and a non-object body untouched (headers still set)', () => {
    const plain = HttpClientRequest.post('http://x.test/').pipe(
      HttpClientRequest.bodyText('hello', 'text/plain'),
    );
    const broken = HttpClientRequest.post('http://x.test/').pipe(
      HttpClientRequest.bodyText('{nope', 'application/json'),
    );
    const list = post([1, 2]);
    for (const request of [plain, broken, list]) {
      const out = stampRequest(request, stamp);
      expect(out.body).toEqual(request.body);
      expect(out.headers['x-litellm-tags']).toBe('host:ct100');
    }
  });
});

describe('joinTags', () => {
  test('joins a list and passes a joined string through', () => {
    expect(joinTags(['host:ct100', 'lane:x'])).toBe('host:ct100,lane:x');
    expect(joinTags('host:ct100,lane:x')).toBe('host:ct100,lane:x');
  });

  test.each([[''], ['has space'], ['new\nline'], ['ünï'], ['a'.repeat(129)]])(
    'refuses %j',
    (tag) => {
      expect(() => joinTags([tag])).toThrow(/not a tag/);
    },
  );

  test('refuses an empty list', () => {
    expect(() => joinTags([])).toThrow(/at least one/);
  });
});

test('compat drops `metadata` and forwards unknown keys: why the stamp exists', async () => {
  // ★ MEASURED against the installed rc.115 (2026-09-29). This is the reason the layer
  //   stamps metadata itself, and the canary that says when compat stops dropping it.
  const stub = startStub();
  const client = OpenAiClient.layer({
    apiKey: Redacted.make('test'),
    apiUrl: `${stub.origin}/v1`,
  }).pipe(Layer.provide(FetchHttpClient.layer));
  const model = OpenAiLanguageModel.layer({
    model: 'm',
    config: { metadata: { seat: 'x' }, custom_key: 'kept' },
  }).pipe(Layer.provide(client));
  await Effect.runPromise(LanguageModel.generateText({ prompt: 'p' }).pipe(Effect.provide(model)));
  stub.stop();
  const body = stub.requests[0]?.json ?? {};
  expect('metadata' in body).toBe(false);
  expect(body['custom_key']).toBe('kept');
});
