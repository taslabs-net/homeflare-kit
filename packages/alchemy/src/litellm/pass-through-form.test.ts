import { describe, expect, test } from 'bun:test';
import {
  createBody,
  literalSecretHeaders,
  matches,
  needsReplace,
  updateBody,
} from './pass-through-form.ts';

const PROPS = { path: '/bria', target: 'https://api.bria.ai' };

describe('createBody', () => {
  test('settles the vendor defaults and never sends undefined keys', () => {
    const body = createBody(PROPS, 'ep-1');
    expect(body).toEqual({
      auth: true,
      cost_per_request: 0,
      default_query_params: {},
      headers: {},
      id: 'ep-1',
      include_subpath: false,
      path: '/bria',
      target: 'https://api.bria.ai',
    });
    expect('timeout' in body).toBe(false);
    expect('methods' in body).toBe(false);
    expect('guardrails' in body).toBe(false);
  });

  test('carries a declared nullable field through', () => {
    const body = createBody({ ...PROPS, timeout: 30, methods: ['GET'] }, 'ep-1');
    expect(body.timeout).toBe(30);
    expect(body.methods).toEqual(['GET']);
  });
});

describe('updateBody', () => {
  /** ⛔ `exclude_none` can never clear a field through this call — needsReplace exists for that. */
  test('omits an unset nullable field rather than sending it as null', () => {
    const body = updateBody(PROPS);
    expect('timeout' in body).toBe(false);
    expect('guardrails' in body).toBe(false);
  });

  test('carries a declared value through', () => {
    expect(updateBody({ ...PROPS, timeout: 5 }).timeout).toBe(5);
  });
});

describe('needsReplace', () => {
  const live = (over: Partial<Parameters<typeof needsReplace>[0]>) => ({
    auth: true,
    cost_per_request: 0,
    default_query_params: {},
    headers: {},
    id: 'ep-1',
    include_subpath: false,
    path: '/bria',
    target: 'https://api.bria.ai',
    ...over,
  });

  test('timeout going from set to unset forces a replace', () => {
    expect(needsReplace(live({ timeout: 30 }), PROPS)).toBe(true);
  });

  test('timeout staying unset, or staying set, is not a replace', () => {
    expect(needsReplace(live({}), PROPS)).toBe(false);
    expect(needsReplace(live({ timeout: 30 }), { ...PROPS, timeout: 60 })).toBe(false);
  });

  test('methods and guardrails going from set to unset also force a replace', () => {
    expect(needsReplace(live({ methods: ['GET'] }), PROPS)).toBe(true);
    expect(needsReplace(live({ guardrails: { pii: null } }), PROPS)).toBe(true);
  });
});

describe('matches', () => {
  const live = {
    auth: true,
    cost_per_request: 0,
    default_query_params: {},
    headers: {},
    id: 'ep-1',
    include_subpath: false,
    path: '/bria',
    target: 'https://api.bria.ai',
  };

  test('a settled default matches a declaration that omits the field', () => {
    expect(matches(live, PROPS)).toBe(true);
  });

  test('a changed target does not match', () => {
    expect(matches(live, { ...PROPS, target: 'https://elsewhere.example.com' })).toBe(false);
  });

  test('header order does not matter, header content does', () => {
    expect(
      matches({ ...live, headers: { a: '1', b: '2' } }, { ...PROPS, headers: { b: '2', a: '1' } }),
    ).toBe(true);
    expect(matches({ ...live, headers: { a: '1' } }, { ...PROPS, headers: { a: '2' } })).toBe(
      false,
    );
  });
});

describe('literalSecretHeaders', () => {
  test('an Authorization header without os.environ/ is refused', () => {
    expect(literalSecretHeaders({ Authorization: 'Bearer sk-live-abc123' })).toEqual([
      'Authorization',
    ]);
  });

  test('the os.environ/ reference form is accepted', () => {
    expect(literalSecretHeaders({ Authorization: 'os.environ/UPSTREAM_KEY' })).toEqual([]);
  });

  test('is case-insensitive on the header name and checks every secret-shaped name', () => {
    expect(
      literalSecretHeaders({ 'X-API-Key': 'literal', 'cf-aig-authorization': 'also-literal' }),
    ).toEqual(['X-API-Key', 'cf-aig-authorization']);
  });

  test('an ordinary forwarded header is never flagged', () => {
    expect(literalSecretHeaders({ 'X-Client-Version': '1.2.3' })).toEqual([]);
  });
});
