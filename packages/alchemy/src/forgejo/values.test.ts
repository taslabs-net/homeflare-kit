/**
 * Wire coercions for Forgejo resources — each case is a trap values.ts documents.
 *
 * ⚠️ `@homeflare/forgejo` had no tests; `bun test` exited 1 on "No tests found" and blocked verify.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hookConfigPublic,
  orgSecretEnvKey,
  recordEqual,
  stringArray,
  stringRecord,
} from './values.ts';

describe('stringArray', () => {
  it('sorts for stable comparison', () => {
    assert.deepEqual(stringArray(['push', 'create']), ['create', 'push']);
  });
});

describe('recordEqual', () => {
  it('ignores key order', () => {
    assert.equal(recordEqual({ a: '1', b: '2' }, { b: '2', a: '1' }), true);
    assert.equal(recordEqual({ a: '1' }, { a: '2' }), false);
  });
});

describe('hookConfigPublic', () => {
  it('drops secret from config', () => {
    assert.deepEqual(hookConfigPublic({ secret: 'x', url: 'https://example.test' }), {
      url: 'https://example.test',
    });
  });
});

describe('orgSecretEnvKey', () => {
  it('normalizes org and name into an env key', () => {
    assert.equal(orgSecretEnvKey('homeflare', 'ci-token'), 'FORGEJO_ORG_SECRET_HOMEFLARE_CI_TOKEN');
  });
});

describe('stringRecord', () => {
  it('returns empty for non-objects', () => {
    assert.deepEqual(stringRecord(null), {});
    assert.deepEqual(stringRecord(['x']), {});
  });
});
