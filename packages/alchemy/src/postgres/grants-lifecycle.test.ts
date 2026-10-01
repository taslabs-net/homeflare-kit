/**
 * The base lifecycles of `Postgres.Grants` against `fake-grants-sql.ts`'s server-model
 * fake: greenfield emits REVOKE-then-GRANT per class, a re-run with the previous `output`
 * writes nothing, `read` answers the projection recovered from the attributes, a third
 * grantor's grant survives as `PostgresGrantsRepairRefused`, and the missing role/schema
 * guards refuse before any statement. The repair-specific lifecycles (a table revoke's
 * column collateral, removal revocation, default privileges, a PUBLIC sequence) live in
 * `grants-lifecycle-repair.test.ts`; the ownership and refusal guards in
 * `grants-lifecycle-guards.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { deleteWithClient, readWithClient, reconcileWithClient } from './grants-ops.ts';
import { namesFromAttrs } from './grants-declare.ts';
import type { PostgresGrantsProps } from './grants-attrs.ts';
import {
  PostgresGrantsRepairRefused,
  PostgresGrantsRoleMissing,
  PostgresGrantsSchemaMissing,
} from './grants-errors.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

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
  roles: ['postgres', 'seat_writer'],
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
        undefined,
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
    // One transaction: a live grantee never observes the revoke without the grant.
    expect(fake.transactions).toEqual([writes]);
  });
});

describe('reconcile: convergence', () => {
  test('a re-run with the previous output writes nothing', async () => {
    const fake = makeFakeGrants(catalog);
    const props = { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] };
    const attrs = await run(reconcileWithClient(fake, props, undefined));
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    // The engine's real update flow: `output` (the persisted attributes) is passed back in,
    // and its names are all still declared, so no removed-entries revocation may fire.
    const again = await run(reconcileWithClient(fake, props, attrs));
    expect(again.tables).toEqual([{ table: 'widgets', privileges: ['select'] }]);
    expect(fake.statements.filter((s) => isWrite(s.text)).length).toBe(writesBefore);
  });

  test('readWithClient answers the projection recovered from the attributes', async () => {
    const fake = makeFakeGrants(catalog);
    const attrs = await run(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'widgets', privileges: ['select'] }],
          columnGrants: [{ table: 'widgets', column: 'id', privileges: ['select'] }],
        },
        undefined,
      ),
    );
    const live = await run(readWithClient(fake, namesFromAttrs(attrs), true));
    expect(live?.tables).toEqual([{ table: 'widgets', privileges: ['select'] }]);
    expect(live?.columns).toEqual([{ table: 'widgets', column: 'id', privileges: ['select'] }]);
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
        undefined,
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
    const error = await fails(reconcileWithClient(fake, baseProps, undefined));
    expect(error).toBeInstanceOf(PostgresGrantsRoleMissing);
    expect(fake.statements.filter((s) => isWrite(s.text))).toEqual([]);
  });

  test('refuses when the schema does not exist', async () => {
    const fake = makeFakeGrants({ ...catalog, schemas: [] });
    const error = await fails(reconcileWithClient(fake, baseProps, undefined));
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
        undefined,
      ),
    );
    const before = fake.statements.length;
    await run(
      deleteWithClient(fake, {
        ...baseProps,
        tables: [{ table: 'widgets', privileges: ['select'] }],
      }),
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
