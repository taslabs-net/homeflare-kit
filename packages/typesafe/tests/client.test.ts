/**
 * Constructs the official client without calling the live API.
 */
import { describe, expect, test } from 'bun:test';
import {
  TYPESAFE_API_KEY,
  TYPESAFE_OPENBAO_PATH,
  TypeSafeClient,
  choice,
  createTypeSafeClient,
  createTypeSafeClientFromBinding,
  noul,
  score,
} from '../src/index.ts';

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

  test('secret location is names only — one field everywhere', () => {
    // ⛔ A renamed OpenBao field that does not match the Worker binding is a silent
    //   empty env on workerd. Keep path/field as exported placeholders, never values.
    expect(TYPESAFE_OPENBAO_PATH).toBe('kv/infra/typesafe/homeflare');
    expect(TYPESAFE_API_KEY).toBe('TYPESAFE_API_KEY');
    const client = createTypeSafeClientFromBinding({ [TYPESAFE_API_KEY]: 'test-key' });
    expect(client).toBeInstanceOf(TypeSafeClient);
  });
});
