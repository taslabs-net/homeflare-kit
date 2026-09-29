/**
 * The seat's telemetry against the stub: three OTLP POSTs (traces, logs, metrics), one
 * `traceparent` on every model call, and the run's trace id inside the exported spans.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { API_KEY, type ScenarioResult, runScenario } from './scenario.ts';
import { type Stub, startStub } from './stub.ts';

const PATHS = {
  traces: '/insert/opentelemetry/v1/traces',
  logs: '/insert/opentelemetry/v1/logs',
  metrics: '/opentelemetry/v1/metrics',
} as const;

let stub: Stub;
let result: ScenarioResult;

beforeAll(async () => {
  stub = startStub();
  result = await runScenario(stub);
});
afterAll(() => stub.stop());

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/** Whether `needle` occurs in `haystack`; protobuf carries ids as raw bytes, names as UTF-8. */
function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  for (let at = 0; at + needle.length <= haystack.length; at++) {
    if (needle.every((byte, i) => haystack[at + i] === byte)) return true;
  }
  return false;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('OTLP export', () => {
  test('exactly three POSTs, one per signal, protobuf, each with a body', () => {
    const otlp = stub.requests.filter((request) => request.path.includes('opentelemetry'));
    expect(otlp.map((request) => request.path).sort()).toEqual(Object.values(PATHS).sort());
    for (const request of otlp) {
      expect(request.headers['content-type']).toBe('application/x-protobuf');
      expect(request.bytes.length).toBeGreaterThan(0);
    }
  });

  test('the trace names the run span and the SDK’s model spans', () => {
    const body = stub.at(PATHS.traces)[0]?.bytes ?? new Uint8Array();
    for (const name of ['seat.run', 'LanguageModel.generateText', 'EmbeddingModel.embed']) {
      expect(contains(body, utf8(name))).toBe(true);
    }
  });

  test('the metric and the log line made it out', () => {
    expect(
      contains(stub.at(PATHS.metrics)[0]?.bytes ?? new Uint8Array(), utf8('seat_rounds_total')),
    ).toBe(true);
    expect(
      contains(stub.at(PATHS.logs)[0]?.bytes ?? new Uint8Array(), utf8('seat run finished')),
    ).toBe(true);
  });

  test('no payload carries the API key', () => {
    // ⛔ The key is Redacted end to end; a span attribute or log field must not undo that.
    const key = utf8(API_KEY);
    for (const request of stub.requests.filter((r) => r.path.includes('opentelemetry'))) {
      expect(contains(request.bytes, key)).toBe(false);
    }
  });
});

describe('trace propagation', () => {
  test('every model call carries a traceparent from the run span', () => {
    const calls = [...stub.at('/v1/chat/completions'), ...stub.at('/v1/embeddings')];
    // ping, tool turn, follow-up, embedding.
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      const [version, traceId, spanId, flags] = (call.headers['traceparent'] ?? '').split('-');
      expect(version).toBe('00');
      expect(traceId).toBe(result.traceId);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(flags).toBe('01');
    }
  });

  test('the exported trace holds the same trace id the calls carried', () => {
    const body = stub.at(PATHS.traces)[0]?.bytes ?? new Uint8Array();
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(contains(body, hexToBytes(result.traceId))).toBe(true);
  });
});
