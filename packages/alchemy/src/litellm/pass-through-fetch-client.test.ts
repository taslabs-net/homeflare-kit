/**
 * A stack that also provides Caddy's admin `HttpClient` must not send LiteLLM's list there.
 *
 * ⛔ MEASURED 2026-09-25. `caddyProviders()` provideMerges a client that dials `127.0.0.1:2019`
 *   and ignores the request host. `GET /config/pass_through_endpoint` on that listener is HTTP
 *   200 `null`. `listPassThroughEndpoints` then has no `endpoints` array and `locate` throws.
 *   The call provides `FetchHttpClient`, which still reads an outer `Fetch` — this fake.
 */
import { describe, expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { FAKE_BASE, startFakeLitellm } from './fake-litellm.ts';
import { listPassThroughEndpoints } from './operations.ts';

const MASTER_KEY = 'sk-test-master';

describe('the proxy list', () => {
  test('uses Fetch, not an ambient client that answers null', async () => {
    const fake = startFakeLitellm({
      masterKey: MASTER_KEY,
      seed: [{ auth: true, id: 'live-1', path: '/bria', target: 'https://api.bria.ai' }],
    });
    const ambient = HttpClient.make(() => Effect.die(new Error('ambient client')));
    const rows = await Effect.runPromise(
      listPassThroughEndpoints().pipe(
        Effect.provideService(HttpClient.HttpClient, ambient),
        Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fake.fetch)),
        Effect.provide(credentials({ apiKey: MASTER_KEY, baseUrl: FAKE_BASE })),
        Effect.provide(FetchHttpClient.layer),
      ) as Effect.Effect<readonly { id?: string | null }[], unknown, never>,
    );
    expect(rows.map((row) => row.id)).toEqual(['live-1']);
    expect(fake.requests().map((request) => request.path)).toEqual([
      '/config/pass_through_endpoint',
    ]);
  });
});
