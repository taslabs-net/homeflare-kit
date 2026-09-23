/**
 * Exercises createTypeSafeGatewayClient() with an injected `fetch` — no network, no
 * credential. Run against unchanged `main` (before src/gateway.ts existed) this file
 * fails at the top-level import, proving the module is genuinely new.
 *
 * ⚠️ MEASURED 2026-09-23: `expect(apiPromise).rejects.toThrow(...)` reports a rejecting
 *   `@typesafe-ai/sdk` `APIPromise` as "resolved". `APIPromise extends Promise` and its
 *   constructor settles the NATIVE promise immediately (`super(r => r(void 0))`),
 *   parsing lazily through an overridden `then`/`catch` instead. Bun's `.rejects`
 *   reads the native settled state, not the override, so it always sees `undefined`.
 *   Plain `await` + `try/catch` goes through the override correctly (see `rejects()`
 *   below) — used throughout instead of `.rejects`.
 */
import { describe, expect, test } from 'bun:test';
import {
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
  TypeSafeClient,
  UnprocessableEntityError,
  noul,
} from '@typesafe-ai/sdk';
import { createTypeSafeGatewayClient } from '../src/gateway.ts';
import { GATEWAY_KEY_SOURCE_HEADER, mapRequest } from '../src/gateway-map.ts';
import {
  AUTH_401,
  FAKE_ACCOUNT_ID,
  FAKE_GATEWAY_ID,
  FAKE_TOKEN,
  MALFORMED_2XX_ENVELOPE,
  NO_WHOLESALE_400,
  SUCCESS_ENVELOPE,
} from './gateway-fixtures.ts';

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function recordingFetch(responses: ReadonlyArray<Response>): {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: input, init: init ?? {} });
      const res = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!res) throw new Error('recordingFetch: no response queued');
      return res;
    },
  };
}

function client(fetch: (input: string, init?: RequestInit) => Promise<Response>): TypeSafeClient {
  return createTypeSafeGatewayClient({
    accountId: FAKE_ACCOUNT_ID,
    token: FAKE_TOKEN,
    gatewayId: FAKE_GATEWAY_ID,
    fetch,
  });
}

/** Awaits `promise`, asserting it rejects — see the file header on why not `.rejects`. */
async function rejects(promise: PromiseLike<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('createTypeSafeGatewayClient', () => {
  test('returns an official TypeSafeClient', () => {
    expect(client(recordingFetch([jsonResponse(200, {})]).fetch)).toBeInstanceOf(TypeSafeClient);
  });

  test('maps the request: URL, method, exact headers, body — sentinel key never sent', async () => {
    const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
    await client(rec.fetch).systemOne({
      state: 'hi',
      questions: { billing: noul('about billing?') },
    });

    expect(rec.calls).toHaveLength(1);
    const first = rec.calls[0];
    if (!first) throw new Error('expected a recorded call');
    const { url, init } = first;
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${FAKE_ACCOUNT_ID}/ai/run`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');

    const headers = init.headers as Record<string, string>;
    expect(headers).toEqual({
      Authorization: `Bearer ${FAKE_TOKEN}`,
      'cf-aig-gateway-id': FAKE_GATEWAY_ID,
      'cf-aig-no-wholesale': 'true',
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(JSON.stringify(headers)).not.toContain('homeflare-gateway-transport-sentinel');

    const body = JSON.parse(init.body as string) as {
      model: string;
      input: Record<string, unknown>;
    };
    expect(body).toEqual({
      model: 'typesafe/jev',
      input: { state: 'hi', questions: { billing: noul('about billing?') } },
    });
    expect(body.input).not.toHaveProperty('model');
  });

  test('maps a 200 response: typed answers, and keySource via .withResponse()', async () => {
    const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
    const { data, response } = await client(rec.fetch)
      .systemOne({ state: 'hi', questions: { billing: noul('about billing?') } })
      .withResponse();

    expect(data.model).toBe('jev-1.13.0');
    expect(data.answers.billing.noul).toBe(0.87);
    expect(response.headers.get(GATEWAY_KEY_SOURCE_HEADER)).toBe('BYOK');
  });

  test('maps a 400 envelope to BadRequestError carrying the Cloudflare code and message', async () => {
    const rec = recordingFetch([jsonResponse(400, NO_WHOLESALE_400)]);
    const err = await rejects(
      client(rec.fetch).systemOne({ state: 'hi', questions: { billing: noul('x') } }),
    );
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toMatch(/2016.*no applicable credentials/);
  });

  test('maps a 401 envelope to AuthenticationError', async () => {
    const rec = recordingFetch([jsonResponse(401, AUTH_401)]);
    const err = await rejects(
      client(rec.fetch).systemOne({ state: 'hi', questions: { billing: noul('x') } }),
    );
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  test('a 429 with Retry-After is retried per the SDK policy, then succeeds', async () => {
    const rec = recordingFetch([
      jsonResponse(
        429,
        { success: false, result: null, errors: [{ code: 3, message: 'rate limited' }] },
        { 'retry-after': '0' },
      ),
      jsonResponse(200, SUCCESS_ENVELOPE),
    ]);
    const result = await client(rec.fetch).systemOne({
      state: 'hi',
      questions: { billing: noul('x') },
    });
    expect(result.model).toBe('jev-1.13.0');
    expect(rec.calls).toHaveLength(2);
  });

  test('rejects RateLimitError when retries are exhausted', async () => {
    const rec = recordingFetch([
      jsonResponse(429, { success: false, result: null, errors: [] }, { 'retry-after': '0' }),
    ]);
    const err = await rejects(
      client(rec.fetch).systemOne(
        { state: 'hi', questions: { billing: noul('x') } },
        { retry: { maxRetries: 0 } },
      ),
    );
    expect(err).toBeInstanceOf(RateLimitError);
  });

  test('a 2xx with an unexpected shape is a non-retryable error with exactly one inner call', async () => {
    const rec = recordingFetch([jsonResponse(200, MALFORMED_2XX_ENVELOPE)]);
    const err = await rejects(
      client(rec.fetch).systemOne({ state: 'hi', questions: { billing: noul('x') } }),
    );
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect(rec.calls).toHaveLength(1);
  });

  test('models.list() gives NotFoundError with zero inner calls', async () => {
    const rec = recordingFetch([jsonResponse(200, {})]);
    const err = await rejects(client(rec.fetch).models.list());
    expect(err).toBeInstanceOf(NotFoundError);
    expect(rec.calls).toHaveLength(0);
  });

  test('an extra top-level request property is refused with zero inner calls', () => {
    const route = {
      accountId: FAKE_ACCOUNT_ID,
      token: FAKE_TOKEN,
      gatewayId: FAKE_GATEWAY_ID,
      catalogModel: 'typesafe/jev',
    };
    const result = mapRequest(
      'https://typesafe-gateway.invalid/v1/systemone',
      {
        method: 'POST',
        body: JSON.stringify({ state: 'hi', questions: {}, model: 'jev-latest', extra: 'nope' }),
      },
      route,
    );
    expect('refusal' in result).toBe(true);
    if ('refusal' in result) expect(result.refusal.status).toBe(400);
  });

  test('a GET (e.g. models.list) is refused locally, never reaching the network', () => {
    const route = {
      accountId: FAKE_ACCOUNT_ID,
      token: FAKE_TOKEN,
      gatewayId: FAKE_GATEWAY_ID,
      catalogModel: 'typesafe/jev',
    };
    const result = mapRequest(
      'https://typesafe-gateway.invalid/v1/models',
      { method: 'GET' },
      route,
    );
    expect('refusal' in result).toBe(true);
    if ('refusal' in result) expect(result.refusal.status).toBe(404);
  });

  test('an aborted signal gives APIUserAbortError', async () => {
    const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
    const controller = new AbortController();
    controller.abort();
    const err = await rejects(
      client(rec.fetch).systemOne(
        { state: 'hi', questions: { billing: noul('x') } },
        { signal: controller.signal },
      ),
    );
    expect(err.name).toBe('APIUserAbortError');
  });
});
