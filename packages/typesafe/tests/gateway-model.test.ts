/**
 * Tests for the Jev version-mismatch guard (Decision 23, 2026-09-23) — see
 * ../src/gateway-model.ts for the "why" and the SDK behaviour these prove against.
 * Run against unchanged `main` (before src/gateway-model.ts existed) this file fails at
 * the top-level import, proving the guard is genuinely new. Reverted locally (this file
 * kept, src/gateway-model.ts deleted and src/gateway-map.ts's and src/gateway.ts's
 * edits undone) every case below also goes red — checked before opening the PR, see
 * its description.
 *
 * Same `rejects()` helper as gateway.test.ts, same reason: Bun's `.rejects` reads a
 * `@typesafe-ai/sdk` `APIPromise`'s NATIVE settled state, which the SDK's lazy
 * `then`/`catch` override never touches, so `.rejects` always sees "resolved" (measured
 * 2026-09-23; see gateway.test.ts's file header).
 */
import { describe, expect, test } from 'bun:test';
import { type TypeSafeClient, UnprocessableEntityError, noul } from '@typesafe-ai/sdk';
import { GATEWAY_MODEL_HEADER, modelMismatchOf } from '../src/gateway-model.ts';
import { type TypeSafeGatewayOptions, createTypeSafeGatewayClient } from '../src/gateway.ts';
import {
  FAKE_ACCOUNT_ID,
  FAKE_GATEWAY_ID,
  FAKE_TOKEN,
  MALFORMED_2XX_ENVELOPE,
  MISMATCHED_MODEL_ENVELOPE,
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
      if (!res) throw new Error('recordingFetch: no response queued');
      return res;
    },
  };
}

function client(
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
  extra: Partial<TypeSafeGatewayOptions> = {},
): TypeSafeClient {
  return createTypeSafeGatewayClient({
    accountId: FAKE_ACCOUNT_ID,
    token: FAKE_TOKEN,
    gatewayId: FAKE_GATEWAY_ID,
    fetch,
    ...extra,
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

const QUESTIONS = { billing: noul('about billing?') };

describe('gateway model-mismatch guard', () => {
  test('(a) an explicit pin the answer disagrees with is refused, exactly once, both models on the error', async () => {
    const rec = recordingFetch([jsonResponse(200, MISMATCHED_MODEL_ENVELOPE)]);
    const err = await rejects(
      client(rec.fetch).systemOne({ state: 'hi', questions: QUESTIONS, model: 'jev-1.13.0' }),
    );
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect(modelMismatchOf(err)).toEqual({ requested: 'jev-1.13.0', answered: 'jev-9.9.9' });
    expect((err as UnprocessableEntityError).headers.get(GATEWAY_MODEL_HEADER)).toBe('jev-9.9.9');
    // Exactly one inner call: 422 sits outside the SDK's default retry set, and the
    // mismatch guard returns a Response rather than throwing — see gateway-model.ts.
    expect(rec.calls).toHaveLength(1);
  });

  test('(b) an explicit pin the answer matches resolves; the model header is visible via withResponse()', async () => {
    const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
    const { data, response } = await client(rec.fetch)
      .systemOne({ state: 'hi', questions: QUESTIONS, model: 'jev-1.13.0' })
      .withResponse();
    expect(data.model).toBe('jev-1.13.0');
    expect(response.headers.get(GATEWAY_MODEL_HEADER)).toBe('jev-1.13.0');
  });

  test('(c) an alias, or no model at all, is never refused, and the header still records the answer', async () => {
    const requests = [
      { state: 'hi', questions: QUESTIONS, model: 'jev-latest' as const },
      { state: 'hi', questions: QUESTIONS, model: 'jev-preview' as const },
      { state: 'hi', questions: QUESTIONS }, // omitted entirely, not `model: undefined`
    ];
    for (const request of requests) {
      const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
      const { data, response } = await client(rec.fetch).systemOne(request).withResponse();
      expect(data.model).toBe('jev-1.13.0');
      expect(response.headers.get(GATEWAY_MODEL_HEADER)).toBe('jev-1.13.0');
    }
  });

  test('(d) collectLog: true sends cf-aig-collect-log: true', async () => {
    const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
    await client(rec.fetch, { collectLog: true }).systemOne({ state: 'hi', questions: QUESTIONS });
    const headers = rec.calls[0]?.init.headers as Record<string, string>;
    expect(headers['cf-aig-collect-log']).toBe('true');
  });

  test('(d) SDK defaultHeaders cannot re-enable logging behind collectLog: false', async () => {
    const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
    await client(rec.fetch, { defaultHeaders: { 'cf-aig-collect-log': 'true' } }).systemOne({
      state: 'hi',
      questions: QUESTIONS,
    });
    const headers = rec.calls[0]?.init.headers as Record<string, string>;
    expect(headers['cf-aig-collect-log']).toBe('false');
  });

  test('(d) a per-call headers option cannot re-enable logging behind collectLog: false', async () => {
    const rec = recordingFetch([jsonResponse(200, SUCCESS_ENVELOPE)]);
    await client(rec.fetch).systemOne(
      { state: 'hi', questions: QUESTIONS },
      { headers: { 'cf-aig-collect-log': 'true' } },
    );
    const headers = rec.calls[0]?.init.headers as Record<string, string>;
    expect(headers['cf-aig-collect-log']).toBe('false');
  });

  test('(e) modelMismatchOf is undefined for the unrelated 200-unexpected-shape refusal', async () => {
    const rec = recordingFetch([jsonResponse(200, MALFORMED_2XX_ENVELOPE)]);
    const err = await rejects(client(rec.fetch).systemOne({ state: 'hi', questions: QUESTIONS }));
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect(modelMismatchOf(err)).toBeUndefined();
  });

  test('(e) modelMismatchOf is undefined for an unrelated 400', async () => {
    const rec = recordingFetch([jsonResponse(400, NO_WHOLESALE_400)]);
    const err = await rejects(client(rec.fetch).systemOne({ state: 'hi', questions: QUESTIONS }));
    expect(modelMismatchOf(err)).toBeUndefined();
  });

  test('modelMismatchOf is undefined for a value with no status/body shape at all', () => {
    expect(modelMismatchOf(new Error('boom'))).toBeUndefined();
    expect(modelMismatchOf(undefined)).toBeUndefined();
  });
});
