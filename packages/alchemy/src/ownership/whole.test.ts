/**
 * whole.ts `carries`: a state row's props against the declaration — every declared value, Outputs
 * included, needs a value in the row; an optional prop left out of both is no hole.
 */
import { describe, expect, test } from 'bun:test';
import { carries } from './whole.ts';

/** Stands in for an Output: Alchemy's are function-typed proxies (Diff.ts stripUnresolved). */
const output = Object.assign(() => undefined, { kind: 'Output' });

describe('carries', () => {
  test('a row with every declared value is whole; an omission from both is no hole', () => {
    expect(carries({ name: 'a', ttl: output }, { name: 'a', ttl: '15m' })).toBe(true);
    expect(carries({ name: 'a', ttl: undefined }, { name: 'a' })).toBe(true);
    expect(carries(undefined, { name: 'a' })).toBe(true);
  });

  test('a declared value — an Output or a literal — missing from the row is a hole', () => {
    expect(carries({ name: output, ttl: '15m' }, { ttl: '15m' })).toBe(false);
    expect(carries({ name: 'a', ttl: '15m' }, { name: 'a' })).toBe(false);
    expect(carries({ name: 'a' }, undefined)).toBe(false);
  });

  test('holes inside arrays and nested objects count, as JSON stores keep them (null)', () => {
    expect(carries({ policies: ['a', output] }, { policies: ['a', null] })).toBe(false);
    expect(carries({ policies: ['a', output] }, { policies: ['a'] })).toBe(false);
    expect(carries({ policies: [{ groups: [output] }] }, { policies: [{ groups: [] }] })).toBe(
      false,
    );
    expect(carries({ policies: [{ groups: ['g'] }] }, { policies: [{ groups: ['g'] }] })).toBe(
      true,
    );
  });

  test('a shape the row does not share is not the declaration', () => {
    expect(carries({ policies: ['a'] }, { policies: 'a' })).toBe(false);
    expect(carries({ tune: { ttl: '1h' } }, { tune: '1h' })).toBe(false);
  });
});
