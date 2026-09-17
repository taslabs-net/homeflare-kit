/**
 * Constructs the official client without calling the live API.
 */
import { describe, expect, test } from 'bun:test';
import { TypeSafeClient, choice, createTypeSafeClient, noul, score } from '../src/index.ts';

describe('createTypeSafeClient', () => {
  test('returns an official TypeSafeClient when given an explicit key', () => {
    const client = createTypeSafeClient({ apiKey: 'test-key' });

    expect(client).toBeInstanceOf(TypeSafeClient);
    expect(typeof client.systemOne).toBe('function');
  });

  test('re-exports the official question helpers', () => {
    expect(typeof choice).toBe('function');
    expect(typeof noul).toBe('function');
    expect(typeof score).toBe('function');
  });
});
