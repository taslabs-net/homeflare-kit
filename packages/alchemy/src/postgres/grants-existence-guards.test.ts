/**
 * Existence guards: every declared table and column must exist before any statement runs.
 * Missing objects fail typed `PostgresGrantsTableMissing` / `PostgresGrantsColumnMissing`
 * without touching catalogs, and a dropped database makes `delete` idempotent.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import type { PgContext } from './connection.ts';
import { makeFakeGrants } from './fake-grants-sql.ts';
import {
  PostgresGrantsColumnMissing,
  PostgresGrantsDatabaseMismatch,
  PostgresGrantsTableMissing,
} from './grants-errors.ts';
import { deleteWithClient, reconcileWithClient } from './grants-ops.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

const context: PgContext = { database: 'agents' };

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
        context,
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
        context,
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
        context,
      ),
    );
    expect(fake.statements.map((s) => s.text).some(isWrite)).toBe(true);
  });
});

describe('delete: idempotent when the database was dropped', () => {
  test('a missing declared database is a silent no-op', async () => {
    const fake = makeFakeGrants(catalog);
    await run(
      deleteWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        { database: 'postgres' },
      ),
    );
    expect(fake.statements.map((s) => s.text).filter(isWrite)).toEqual([]);
  });

  test('a present but mismatched database still fails', async () => {
    const fake = makeFakeGrants({ ...catalog, databases: ['agents'] });
    const error = await fails(
      deleteWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        { database: 'postgres' },
      ),
    );
    expect(error).toBeInstanceOf(PostgresGrantsDatabaseMismatch);
  });
});
