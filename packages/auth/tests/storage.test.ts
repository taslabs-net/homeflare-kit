/**
 * The storage primitive, not an auth instance.
 *
 * ★ Construction only — a real D1 query belongs in the consuming Worker. This asserts
 *   the contract AnyAuth asked for: `{ db, database }` from official SDKs, with
 *   `database` being the adapter factory Better Auth's `database` option accepts.
 */
import { describe, expect, test } from 'bun:test';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { type D1AuthBinding, createD1AuthStorage } from '../src/storage.ts';
import * as published from '../src/index.ts';

function unusedD1(): D1AuthBinding {
  // Construction-only stub. A real D1 query belongs in the consuming Worker.
  return {
    prepare() {
      throw new Error('storage test does not query');
    },
  } as unknown as D1AuthBinding;
}

const user = sqliteTable('user', {
  id: text('id').primaryKey(),
});
const schema = { user };

describe('createD1AuthStorage', () => {
  test('returns db and the official adapter factory, not an auth instance', () => {
    const { db, database } = createD1AuthStorage(unusedD1(), schema);

    expect(db).toBeDefined();
    expect(db.$client).toBeDefined();
    expect(typeof database).toBe('function');
    expect(db).not.toHaveProperty('api');
    expect(db).not.toHaveProperty('handler');
  });

  test('binds the D1 client onto db.$client so the app can still reach the binding', () => {
    const binding = unusedD1();
    const { db } = createD1AuthStorage(binding, schema);

    expect(db.$client).toBe(binding);
  });
});

describe('published surface', () => {
  test('exports the primitive and VERSION, not betterAuth', () => {
    expect(typeof published.createD1AuthStorage).toBe('function');
    expect(typeof published.VERSION).toBe('string');
    expect(published).not.toHaveProperty('betterAuth');
    expect(published).not.toHaveProperty('createAuth');
  });
});
