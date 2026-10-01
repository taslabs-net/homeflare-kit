/**
 * The ownership and refusal guards of `Postgres.Grants`, replayed against the fake server
 * model: objects the declared role OWNS are never touched (an owner holds every privilege
 * implicitly and a REVOKE cannot take that away — measured on PG 18.6, where a repair left
 * the docs' own seat example with an empty ACL on its own schema), the three
 * database-mismatch refusals fire before any statement, the reconcile-side retarget guard
 * closes the plan-time bypass, and `delete` is a no-op when the role or schema is missing or
 * the target holds no grants. The read path's absent-vs-projection faces live in
 * `grants-read-absent.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { deleteWithClient, readWithClient, reconcileWithClient } from './grants-ops.ts';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';
import { PostgresGrantsDatabaseMismatch, PostgresGrantsRetargetRefused } from './grants-errors.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

const baseProps: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaUsage: true,
};

/** The seat model: `notes` (with its column) and its catalog are the seat's OWN objects;
 * `shared` is someone else's. The schema is still owned by the executor. */
const ownedCatalog = {
  schemas: ['app'],
  roles: ['postgres', 'seat_writer'],
  databases: ['agents'],
  tables: [
    { schema: 'app', table: 'notes', owner: 'seat_writer', columns: ['id'] },
    { schema: 'app', table: 'shared' },
  ],
};

const writesOf = (fake: ReturnType<typeof makeFakeGrants>): ReadonlyArray<string> =>
  fake.statements.map((s) => s.text).filter(isWrite);

const applied = (over: Partial<PostgresGrantsAttributes>): PostgresGrantsAttributes => ({
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaPrivileges: [],
  tables: [],
  columns: [],
  defaults: [],
  publicSchemaRevoked: false,
  publicTablesRevoked: false,
  schemaOwnedByRole: false,
  ownedTables: [],
  ...over,
});

describe('reconcile: objects the role owns are left alone', () => {
  test('an owned table is skipped by repair, delete and the projection', async () => {
    const fake = makeFakeGrants(ownedCatalog);
    const props: PostgresGrantsProps = {
      ...baseProps,
      tables: [
        { table: 'notes', privileges: ['select'] },
        { table: 'shared', privileges: ['select'] },
      ],
      columnGrants: [{ table: 'notes', column: 'id', privileges: ['select'] }],
    };
    const attrs = await run(reconcileWithClient(fake, props, undefined));
    // Only the NOT-owned table is repaired; the owned one records an empty word list and
    // its name in ownedTables (the owner holds everything implicitly, whatever the ACL says).
    expect(attrs.tables).toEqual([
      { table: 'notes', privileges: [] },
      { table: 'shared', privileges: ['select'] },
    ]);
    expect(attrs.columns).toEqual([{ table: 'notes', column: 'id', privileges: [] }]);
    expect(attrs.ownedTables).toEqual(['notes']);
    expect(attrs.schemaOwnedByRole).toBe(false);
    expect(writesOf(fake)).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'GRANT usage ON SCHEMA "app" TO "seat_writer"',
      'REVOKE ALL ON "app"."shared" FROM "seat_writer"',
      'GRANT select ON "app"."shared" TO "seat_writer"',
    ]);
    // delete revokes the schema grant and `shared` only: stripping the owner's ACL would
    // strip rights that existed before this resource (the round-1 finding's empty relacl).
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    await run(deleteWithClient(fake, props));
    expect(writesOf(fake).slice(writesBefore)).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'REVOKE ALL ON "app"."shared" FROM "seat_writer"',
    ]);
  });

  test('a schema the role owns is skipped entirely by reconcile and delete', async () => {
    const fake = makeFakeGrants({
      schemas: ['app'],
      roles: ['postgres', 'seat_writer'],
      schemaOwner: 'seat_writer',
      tables: [{ schema: 'app', table: 'notes', owner: 'seat_writer' }],
    });
    const props: PostgresGrantsProps = { ...baseProps, schemaCreate: true };
    const attrs = await run(reconcileWithClient(fake, props, undefined));
    expect(attrs.schemaOwnedByRole).toBe(true);
    expect(attrs.schemaPrivileges).toEqual([]);
    // A revoke on the seat's own schema would leave it without USAGE on the very schema it
    // owns — the regression the round-1 review measured — so nothing runs at all.
    expect(writesOf(fake)).toEqual([]);
    await run(deleteWithClient(fake, props));
    expect(writesOf(fake)).toEqual([]);
  });
});

describe('current_database() must be the declared database', () => {
  test('reconcile, read and delete each refuse before any write', async () => {
    const fake = makeFakeGrants({ ...ownedCatalog, connected: 'other_db' });
    const reconcileError = await fails(
      reconcileWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'shared', privileges: ['select'] }] },
        undefined,
      ),
    );
    expect(reconcileError).toBeInstanceOf(PostgresGrantsDatabaseMismatch);
    expect((reconcileError as PostgresGrantsDatabaseMismatch).connected).toBe('other_db');
    const readError = await fails(
      readWithClient(
        fake,
        {
          role: 'seat_writer',
          database: 'agents',
          schema: 'app',
          tables: [],
          columns: [],
          defaults: [],
        },
        false,
      ),
    );
    expect(readError).toBeInstanceOf(PostgresGrantsDatabaseMismatch);
    const deleteError = await fails(deleteWithClient(fake, baseProps));
    expect(deleteError).toBeInstanceOf(PostgresGrantsDatabaseMismatch);
    expect(fake.statements.map((s) => s.text).filter(isWrite)).toEqual([]);
    expect(fake.statements.some((s) => s.text.startsWith('SELECT current_database()'))).toBe(true);
  });
});

describe('reconcile: the retarget guard cannot be bypassed by an unresolved plan', () => {
  test('an output naming a different role, database or schema is refused before any statement', async () => {
    const fake = makeFakeGrants(ownedCatalog);
    const props: PostgresGrantsProps = {
      ...baseProps,
      tables: [{ table: 'shared', privileges: ['select'] }],
    };
    // `news` unresolved at plan time would let the engine's own comparison answer update;
    // reconcile, where news IS resolved, re-checks the persisted identity against the
    // declaration (a same-deploy role rename would otherwise land on the new role while
    // the old one keeps every privilege).
    const variants: ReadonlyArray<readonly [string, PostgresGrantsAttributes]> = [
      ['role', applied({ role: 'seat_old' })],
      ['database', applied({ database: 'other_db' })],
      ['schema', applied({ schema: 'other_schema' })],
    ];
    for (const [prop, output] of variants) {
      const error = await fails(reconcileWithClient(fake, props, output));
      expect(error, prop).toBeInstanceOf(PostgresGrantsRetargetRefused);
      expect((error as PostgresGrantsRetargetRefused).prop).toBe(prop);
    }
    expect(fake.statements).toEqual([]);
  });
});

describe('delete: a no-op when the target is gone or holds nothing', () => {
  test('writes nothing when the grantee role no longer exists', async () => {
    const fake = makeFakeGrants({ ...ownedCatalog, roles: [] });
    await run(
      deleteWithClient(fake, {
        ...baseProps,
        tables: [{ table: 'shared', privileges: ['select'] }],
      }),
    );
    expect(fake.statements.filter((s) => isWrite(s.text))).toEqual([]);
  });

  test('writes nothing when the schema no longer exists', async () => {
    const fake = makeFakeGrants({ ...ownedCatalog, schemas: [] });
    await run(
      deleteWithClient(fake, {
        ...baseProps,
        tables: [{ table: 'shared', privileges: ['select'] }],
      }),
    );
    expect(fake.statements.filter((s) => isWrite(s.text))).toEqual([]);
  });

  test('writes nothing when the target holds no grants (the idempotent re-delete)', async () => {
    const fake = makeFakeGrants(ownedCatalog);
    await run(
      deleteWithClient(fake, {
        ...baseProps,
        tables: [{ table: 'shared', privileges: ['select'] }],
      }),
    );
    expect(fake.statements.filter((s) => isWrite(s.text))).toEqual([]);
  });
});
