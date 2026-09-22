/**
 * write-only.ts — resolving `{ fromEnv }` and the seal a plan compares instead of a value.
 *
 * ★ THE SEAL IS THE WHOLE CHANGE-DETECTION STORY FOR A SECRET THE SERVER WILL NOT RETURN, so each
 *   property it relies on is pinned: the same values verify, a different value does not, key order
 *   does not matter, and nothing malformed ever reads as a match.
 */
import { describe, expect, test } from 'bun:test';
import { resolveAll, seal, sealMatches } from './write-only.ts';

describe('resolveAll', () => {
  test('resolves by variable name and reports every missing or empty one, by name', () => {
    const env = { HOOK: 's3cret', EMPTY: '' };
    const got = resolveAll(
      { a: { fromEnv: 'HOOK' }, b: { fromEnv: 'EMPTY' }, c: { fromEnv: 'UNSET' } },
      env,
    );
    expect(got.values).toEqual({ a: 's3cret' });
    expect(got.missing).toEqual(['EMPTY', 'UNSET']);
  });

  test('does not trim: the value sent is the value in the environment', () => {
    expect(resolveAll({ a: { fromEnv: 'X' } }, { X: ' v\n' }).values).toEqual({ a: ' v\n' });
  });
});

describe('seal', () => {
  const values = { 'secret:token': 'correct horse', password: 'battery staple' };

  test('verifies the values it was made from, and no others', () => {
    const sealed = seal(values);
    expect(sealed).toStartWith('scrypt:');
    expect(sealMatches(sealed, values)).toBe(true);
    expect(sealMatches(sealed, { ...values, password: 'battery staplf' })).toBe(false);
    expect(sealMatches(sealed, { 'secret:token': 'correct horse' })).toBe(false);
  });

  test('never contains a value, raw or base64', () => {
    const sealed = seal(values);
    for (const value of Object.values(values)) {
      expect(sealed).not.toContain(value);
      expect(sealed).not.toContain(Buffer.from(value).toString('base64'));
    }
  });

  test('key order is not a change', () => {
    const sealed = seal({ a: '1', b: '2' });
    expect(sealMatches(sealed, { b: '2', a: '1' })).toBe(true);
  });

  test('a random salt by default: sealing twice gives two seals that both verify', () => {
    const one = seal(values);
    const two = seal(values);
    expect(one).not.toBe(two);
    expect(sealMatches(two, values)).toBe(true);
  });

  test('a fixed salt is deterministic — what a header digest needs to not churn state', () => {
    expect(seal(values, 'fixed')).toBe(seal(values, 'fixed'));
    expect(seal(values, 'fixed')).not.toBe(seal(values, 'other'));
  });

  test('nothing to seal is the empty string, and only nothing matches it', () => {
    expect(seal({})).toBe('');
    expect(sealMatches('', {})).toBe(true);
    expect(sealMatches('', values)).toBe(false);
  });

  test('a malformed seal is never a match', () => {
    const [, salt, digest] = seal(values).split(':');
    for (const bad of [`md5:${salt}:${digest}`, `scrypt:${salt}`, `scrypt:${salt}:${digest}:x`]) {
      expect(sealMatches(bad, values)).toBe(false);
    }
  });
});
