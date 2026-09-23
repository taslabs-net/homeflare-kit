/**
 * Structural validation, freezing and the `json` byte contract — the mechanics of
 * gate.ts that do not depend on any one secret shape (see gate-secrets.test.ts for
 * those). Every test here is red on origin/main: packages/typesafe/src/gate does not
 * exist there, so this whole file fails to resolve its import.
 */
import { describe, expect, test } from 'bun:test';
import { type Fetch, type JsonValue, noul } from '@typesafe-ai/sdk';
import { createTypeSafeGatewayClient } from '../src/gateway.ts';
import { type JudgmentSpec, gate } from '../src/gate/gate.ts';

const TICKET_SPEC: JudgmentSpec = {
  ticket: { type: 'string', maxLength: 4000 },
  tags: { type: 'string[]', maxItems: 5, maxLength: 40 },
  priority: { type: 'number' },
  urgent: { type: 'boolean' },
  meta: { type: 'object', fields: { source: { type: 'string', maxLength: 20 } } },
};

/** Compile-time proof of the readonly-array trap (AGENTS.md, PR 115): if `deepFreeze`
 *  ever regressed to the built-in `Object.freeze<T>(o: T): Readonly<T>` signature, this
 *  assignment would fail `tsc --noEmit` (part of `bun run check`) because a
 *  `readonly X[]` is not a `JsonValue`'s mutable `X[]`. */
function assertIsJsonValue(_value: JsonValue): void {}

describe('gate: structural validation', () => {
  test('a clean payload sends', () => {
    const result = gate(TICKET_SPEC, {
      state: { ticket: 'hello', tags: ['a', 'b'] },
      questions: { billing: {} },
    });
    expect(result.kind).toBe('send');
  });

  test('an unknown field refuses', () => {
    const result = gate(TICKET_SPEC, { state: { ticket: 'hi', extra: 'nope' }, questions: {} });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'unknown-field',
      path: '$.state.extra',
    });
  });

  test('an over-length string refuses, never truncates', () => {
    const spec: JudgmentSpec = { note: { type: 'string', maxLength: 5 } };
    const result = gate(spec, { state: { note: 'toolong' }, questions: {} });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'over-length',
      path: '$.state.note',
    });
  });

  test('an over-count array refuses', () => {
    const result = gate(TICKET_SPEC, {
      state: { tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
      questions: {},
    });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'over-count',
      path: '$.state.tags',
    });
  });

  test('an over-length array ELEMENT refuses, at its own indexed path', () => {
    const result = gate(TICKET_SPEC, { state: { tags: ['ok', 'x'.repeat(41)] }, questions: {} });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'over-length',
      path: '$.state.tags[1]',
    });
  });

  test('wrong types refuse: string where number expected', () => {
    const result = gate(TICKET_SPEC, { state: { priority: 'high' }, questions: {} });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'wrong-type',
      path: '$.state.priority',
    });
  });

  test('a nested object field is validated recursively', () => {
    const result = gate(TICKET_SPEC, {
      state: { meta: { source: 'x'.repeat(21) } },
      questions: {},
    });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'over-length',
      path: '$.state.meta.source',
    });
  });

  test('a nested object with an unknown field refuses at the nested path', () => {
    const result = gate(TICKET_SPEC, { state: { meta: { bogus: 1 } }, questions: {} });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'unknown-field',
      path: '$.state.meta.bogus',
    });
  });

  test('non-object state refuses', () => {
    const result = gate(TICKET_SPEC, { state: 'not an object', questions: {} });
    expect(result).toMatchObject({ kind: 'no-judgment', reason: 'not-object', path: '$.state' });
  });

  test('an array for state refuses (arrays are not objects here)', () => {
    const result = gate(TICKET_SPEC, { state: ['a'], questions: {} });
    expect(result).toMatchObject({ kind: 'no-judgment', reason: 'not-object', path: '$.state' });
  });

  test('non-object questions refuses', () => {
    const result = gate(TICKET_SPEC, { state: {}, questions: 'nope' });
    expect(result).toMatchObject({
      kind: 'no-judgment',
      reason: 'not-object',
      path: '$.questions',
    });
  });
});

describe('gate: send payload shape', () => {
  const payload = {
    state: { ticket: 'hello', tags: ['a', 'b'] },
    questions: { billing: { q: 1 } },
  };

  test('json is exactly JSON.stringify({state, questions}) in that key order', () => {
    const result = gate(TICKET_SPEC, payload);
    if (result.kind !== 'send') throw new Error('expected send');
    expect(result.json).toBe(JSON.stringify({ state: result.state, questions: result.questions }));
    expect(result.json.startsWith('{"state":')).toBe(true);
  });

  test('state and questions are frozen deep copies', () => {
    const result = gate(TICKET_SPEC, payload);
    if (result.kind !== 'send') throw new Error('expected send');
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.tags)).toBe(true);
    expect(Object.isFrozen(result.questions)).toBe(true);
    assertIsJsonValue(result.state);
    assertIsJsonValue(result.questions);
  });

  test("mutating the caller's original after gating changes nothing about what was sent", () => {
    const original = { state: { ticket: 'hello', tags: ['a', 'b'] }, questions: {} };
    const result = gate(TICKET_SPEC, original);
    if (result.kind !== 'send') throw new Error('expected send');
    const before = result.json;
    (original.state as { ticket: string }).ticket = 'mutated';
    original.state.tags.push('z');
    expect(result.json).toBe(before);
    expect(result.state.ticket).toBe('hello');
  });

  test('gate never throws on a wildly malformed payload', () => {
    expect(() => gate(TICKET_SPEC, { state: null, questions: undefined } as never)).not.toThrow();
  });
});

describe('gate -> createTypeSafeGatewayClient: end-to-end byte identity', () => {
  test('what the gate reports as json is exactly what the transport sends as input', async () => {
    const result = gate(TICKET_SPEC, {
      state: { ticket: 'hello from the gate', tags: ['a', 'b'] },
      questions: { billing: noul('Is this about billing?') },
    });
    if (result.kind !== 'send') throw new Error('expected send');

    let capturedBody: string | undefined;
    const fakeFetch: Fetch = async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            result: { model: 'jev-1.13.0', answers: {}, usage: {} },
            gatewayMetadata: { keySource: 'BYOK' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const client = createTypeSafeGatewayClient({
      accountId: '0123456789abcdef0123456789abcdef',
      token: 'fake-token',
      gatewayId: 'example-gateway',
      fetch: fakeFetch,
    });

    // gate() works over generic JSON, on purpose (gate.ts stays SDK-free — see its file
    // header) — a caller narrows `result.questions` back to the SDK's own branded
    // `Questions` type, since they are the ones who built it in the first place.
    await client.systemOne({
      state: result.state,
      questions: result.questions as unknown as Parameters<typeof client.systemOne>[0]['questions'],
    });

    expect(capturedBody).toBeDefined();
    const sentToCloudflare = JSON.parse(capturedBody as string) as { input: unknown };
    expect(JSON.stringify(sentToCloudflare.input)).toBe(result.json);
  });
});
