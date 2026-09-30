/**
 * `reconcile`, `read` and `delete` against `fake-grants-sql.ts`'s server-model fake: greenfield
 * emits REVOKE-then-GRANT, a no-op re-run emits nothing, PUBLIC clearing, third-grantor survival
 * as `PostgresGrantsRepairRefused`, and the missing role/schema/database guards. Every case
 * reverts cleanly by reverting `grants-*.ts` locally: these tests fail on `origin/main` because
 * the files do not exist there.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { deleteWithClient, readWithClient, reconcileWithClient } from './grants.ts';
import type { PgContext } from './connection.ts';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import {
  PostgresGrantsRepairRefused,
  PostgresGrantsRoleMissing,
  PostgresGrantsSchemaMissing,
} from './grants-errors.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

const context: PgContext = { database: 'agents' };

const baseProps: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaUsage: true,
};

/** The catalog a reconcile needs: the schema and grantee role exist, and one table with two
 * columns so column and table grants have a target. */
const catalog = {
  schemas: ['app'],
  roles: ['seat_writer'],
  tables: [{ schema: 'app', table: 'widgets', columns: ['id', 'name'] }],
};

describe('reconcile: greenfield', () => {
  test('issues REVOKE-then-GRANT for each declared class and returns the read-back', async () => {
    const fake = makeFakeGrants(catalog);
    const attrs = await run(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'widgets', privileges: ['select'] }],
          columnGrants: [{ table: 'widgets', column: 'id', privileges: ['select'] }],
        },
        context,
      ),
    );
    expect(attrs.role).toBe('seat_writer');
    expect(attrs.schemaPrivileges).toEqual(['usage']);
    expect(attrs.tables).toEqual([{ table: 'widgets', privileges: ['select'] }]);
    expect(attrs.columns).toEqual([{ table: 'widgets', column: 'id', privileges: ['select'] }]);
    // Reads (the existence checks and the aclexplode projections) are recorded beside the
    // writes; the assertion is on the writes, which are exactly REVOKE-then-GRANT per class.
    const writes = fake.statements.map((s) => s.text).filter(isWrite);
    expect(writes).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'GRANT usage ON SCHEMA "app" TO "seat_writer"',
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'GRANT select ON "app"."widgets" TO "seat_writer"',
      'REVOKE ALL ("id") ON "app"."widgets" FROM "seat_writer"',
      'GRANT select ("id") ON "app"."widgets" TO "seat_writer"',
    ]);
  });
});

describe('reconcile: convergence', () => {
  test('a re-run after a successful reconcile writes nothing', async () => {
    const fake = makeFakeGrants(catalog);
    await run(
      reconcileWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        context,
      ),
    );
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    const again = await run(
      reconcileWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        context,
      ),
    );
    expect(again.tables).toEqual([{ table: 'widgets', privileges: ['select'] }]);
    expect(fake.statements.filter((s) => isWrite(s.text)).length).toBe(writesBefore);
  });

  test('readWithClient answers Unowned-equivalent attributes from the model', async () => {
    const fake = makeFakeGrants(catalog);
    await run(
      reconcileWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        context,
      ),
    );
    const attrs = await run(
      readWithClient(
        fake,
        {
          role: 'seat_writer',
          database: 'agents',
          schema: 'app',
          tables: ['widgets'],
          columns: [],
          defaults: [],
        },
        context,
      ),
    );
    expect(attrs?.tables).toEqual([{ table: 'widgets', privileges: ['select'] }]);
  });

  test('a third grantor\u2019s grant survives REVOKE and surfaces as PostgresGrantsRepairRefused', async () => {
    const fake = makeFakeGrants({
      ...catalog,
      acl: [
        {
          object: { schema: 'app', table: 'widgets' },
          grantee: 'seat_writer',
          grantor: 'someone_else',
          words: ['delete'],
        },
      ],
    });
    const error = await fails(
      reconcileWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        context,
      ),
    );
    expect(error).toBeInstanceOf(PostgresGrantsRepairRefused);
    // The surviving grant is a third grantor's 'delete' the executor cannot revoke, so the
    // re-read still plans the table's REVOKE-then-GRANT — that statement list is the refusal.
    expect((error as PostgresGrantsRepairRefused).remaining).toContain(
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
    );
  });
});

describe('reconcile: guards', () => {
  test('refuses before any write when the grantee role is missing', async () => {
    const fake = makeFakeGrants({ ...catalog, roles: [] });
    const error = await fails(reconcileWithClient(fake, baseProps, context));
    expect(error).toBeInstanceOf(PostgresGrantsRoleMissing);
    expect(fake.statements.filter((s) => isWrite(s.text))).toEqual([]);
  });

  test('refuses when the schema does not exist', async () => {
    const fake = makeFakeGrants({ ...catalog, schemas: [] });
    const error = await fails(reconcileWithClient(fake, baseProps, context));
    expect(error).toBeInstanceOf(PostgresGrantsSchemaMissing);
  });
});

describe('delete', () => {
  test('revokes exactly the last declaration\u2019s objects and nothing PUBLIC', async () => {
    const fake = makeFakeGrants(catalog);
    await run(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'widgets', privileges: ['select'] }],
          revokeFromPublic: true,
        },
        context,
      ),
    );
    const before = fake.statements.length;
    await run(
      deleteWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        context,
      ),
    );
    const writes = fake.statements
      .slice(before)
      .map((s) => s.text)
      .filter(isWrite);
    expect(writes).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
    ]);
  });
});
