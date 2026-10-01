/**
 * Existence guards: every declared table and column must exist before any statement runs.
 * Missing objects fail typed `PostgresGrantsTableMissing` / `PostgresGrantsColumnMissing`
 * without touching catalogs. A dotted table name must not collide with a dotted column
 * name: the existence query compares the pair, not `relname || '.' || attname`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { PostgresGrantsColumnMissing, PostgresGrantsTableMissing } from './grants-errors.ts';
import { reconcileWithClient } from './grants-ops.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

const catalog = {
  schemas: ['app'],
  roles: ['postgres', 'seat_writer'],
  tables: [{ schema: 'app', table: 'widgets', columns: ['id'] }],
};

const baseProps: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaUsage: true,
};

describe('reconcile: declared objects must exist before statements run', () => {
  test('a missing table fails as PostgresGrantsTableMissing without writing', async () => {
    const fake = makeFakeGrants(catalog);
    const error = await fails(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [
            { table: 'widgets', privileges: ['select'] },
            { table: 'ghost', privileges: ['select'] },
          ],
        },
        undefined,
      ),
    );
    expect(error).toBeInstanceOf(PostgresGrantsTableMissing);
    expect((error as PostgresGrantsTableMissing).table).toBe('ghost');
    expect(fake.statements.map((s) => s.text).filter(isWrite)).toEqual([]);
  });

  test('a missing column fails as PostgresGrantsColumnMissing without writing', async () => {
    const fake = makeFakeGrants(catalog);
    const error = await fails(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'widgets', privileges: ['select'] }],
          columnGrants: [{ table: 'widgets', column: 'qty', privileges: ['update'] }],
        },
        undefined,
      ),
    );
    expect(error).toBeInstanceOf(PostgresGrantsColumnMissing);
    expect((error as PostgresGrantsColumnMissing).column).toBe('qty');
    expect(fake.statements.map((s) => s.text).filter(isWrite)).toEqual([]);
  });

  test('a real table and column proceed past the guards', async () => {
    const fake = makeFakeGrants(catalog);
    await run(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'widgets', privileges: ['select'] }],
          columnGrants: [{ table: 'widgets', column: 'id', privileges: ['update'] }],
        },
        undefined,
      ),
    );
    expect(fake.statements.map((s) => s.text).some(isWrite)).toBe(true);
  });
});

describe('column existence compares the (table, column) pair', () => {
  test('table `a.b` column `c` does not make table `a` column `b.c` look present', async () => {
    const fake = makeFakeGrants({
      ...catalog,
      tables: [
        { schema: 'app', table: 'a.b', columns: ['c'] },
        { schema: 'app', table: 'a', columns: ['id'] },
      ],
    });
    const error = await fails(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'a', privileges: ['select'] }],
          columnGrants: [{ table: 'a', column: 'b.c', privileges: ['select'] }],
        },
        undefined,
      ),
    );
    expect(error).toBeInstanceOf(PostgresGrantsColumnMissing);
    expect((error as PostgresGrantsColumnMissing).table).toBe('a');
    expect((error as PostgresGrantsColumnMissing).column).toBe('b.c');
    expect(fake.statements.map((s) => s.text).filter(isWrite)).toEqual([]);
  });
});
