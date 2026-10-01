/**
 * The repair-specific lifecycles the round-1 review measured against real PG 18.6, replayed
 * against the fake server model: (1) a table-level REVOKE ALL also clears the grantee's
 * column entries on that table, so a table-words change on a table with declared column
 * grants must re-grant the columns in the SAME pass to converge; (2) removing an entry from
 * the declaration revokes the privilege instead of silently retaining it; (3) default
 * privileges grant, read back and converge; (4) a PUBLIC grant on a SEQUENCE survives the
 * bulk revoke, so it must never block `revokeFromPublic`'s convergence; (5) a multi-word
 * column grant repeats the synopsis per word — every word lands on the column, nothing on
 * the relation, and the parser refuses the single-trailing-list shape PG 18.6 reads as a
 * table-level grant.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { parseGrantStatement } from './fake-grants-parse.ts';
import { reconcileWithClient } from './grants-ops.ts';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

const baseProps: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaUsage: true,
};

/** Three relations and both auxiliary roles: `widgets` carries the declared column,
 * `ledger` the later-removed table grant, `app_seq` a sequence for the relkind-scoped
 * PUBLIC check, and `owner_role` the default-privileges creator. */
const catalog = {
  schemas: ['app'],
  roles: ['postgres', 'seat_writer', 'owner_role'],
  tables: [
    { schema: 'app', table: 'widgets', columns: ['id'] },
    { schema: 'app', table: 'ledger' },
    { schema: 'app', table: 'app_seq', relkind: 'S' },
  ],
};

const writesOf = (fake: ReturnType<typeof makeFakeGrants>): ReadonlyArray<string> =>
  fake.statements.map((s) => s.text).filter(isWrite);

describe('reconcile: a table revoke clears that grantee\u2019s column entries', () => {
  test('a table-words change on a table with declared column grants converges in ONE pass', async () => {
    const fake = makeFakeGrants(catalog);
    const declared = (privileges: ReadonlyArray<string>): PostgresGrantsProps => ({
      ...baseProps,
      tables: [{ table: 'widgets', privileges }],
      columnGrants: [{ table: 'widgets', column: 'id', privileges: ['select'] }],
    });
    const first = await run(reconcileWithClient(fake, declared(['select']), undefined));
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    // The table's words change while its column grant stays declared: the server's REVOKE
    // ALL also takes the column grant away, so the same pass must re-grant it — planned
    // against an empty column set — or the convergence re-read answers drift and refuses.
    const again = await run(reconcileWithClient(fake, declared(['select', 'insert']), first));
    expect(writesOf(fake).slice(writesBefore)).toEqual([
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'GRANT insert, select ON "app"."widgets" TO "seat_writer"',
      'REVOKE ALL ("id") ON "app"."widgets" FROM "seat_writer"',
      'GRANT select ("id") ON "app"."widgets" TO "seat_writer"',
    ]);
    expect(again.tables).toEqual([{ table: 'widgets', privileges: ['insert', 'select'] }]);
    expect(again.columns).toEqual([{ table: 'widgets', column: 'id', privileges: ['select'] }]);
  });
});

describe('reconcile: removal takes the privilege away', () => {
  test('removing table, column and default entries revokes exactly what they held', async () => {
    const fake = makeFakeGrants(catalog);
    const first = await run(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'ledger', privileges: ['select'] }],
          columnGrants: [{ table: 'widgets', column: 'id', privileges: ['select'] }],
          defaultPrivileges: [{ forRole: 'owner_role', privileges: ['select'] }],
        },
        undefined,
      ),
    );
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    // The operator deletes every entry: the seat keeps nothing the resource granted, and
    // the schema grant it still declares stays.
    const after = await run(reconcileWithClient(fake, { ...baseProps }, first));
    expect(writesOf(fake).slice(writesBefore)).toEqual([
      'REVOKE ALL ON "app"."ledger" FROM "seat_writer"',
      'REVOKE ALL ("id") ON "app"."widgets" FROM "seat_writer"',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "owner_role" IN SCHEMA "app" REVOKE ALL ON TABLES FROM "seat_writer"',
    ]);
    expect(after.tables).toEqual([]);
    expect(after.columns).toEqual([]);
    expect(after.defaults).toEqual([]);
    expect(after.schemaPrivileges).toEqual(['usage']);
  });
});

describe('reconcile: default privileges', () => {
  test('grant, read back, and converge on a re-run with the previous output', async () => {
    const fake = makeFakeGrants(catalog);
    const props: PostgresGrantsProps = {
      ...baseProps,
      defaultPrivileges: [{ forRole: 'owner_role', privileges: ['select'] }],
    };
    const attrs: PostgresGrantsAttributes = await run(reconcileWithClient(fake, props, undefined));
    expect(attrs.defaults).toEqual([{ forRole: 'owner_role', privileges: ['select'] }]);
    expect(writesOf(fake)).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'GRANT usage ON SCHEMA "app" TO "seat_writer"',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "owner_role" IN SCHEMA "app" REVOKE ALL ON TABLES FROM "seat_writer"',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "owner_role" IN SCHEMA "app" GRANT select ON TABLES TO "seat_writer"',
    ]);
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    const again = await run(reconcileWithClient(fake, props, attrs));
    expect(again.defaults).toEqual([{ forRole: 'owner_role', privileges: ['select'] }]);
    expect(fake.statements.filter((s) => isWrite(s.text)).length).toBe(writesBefore);
  });
});

describe('reconcile: PUBLIC on a sequence', () => {
  test('revokeFromPublic converges with a PUBLIC grant on a sequence in the schema', async () => {
    const fake = makeFakeGrants({
      ...catalog,
      acl: [
        {
          object: { schema: 'app', table: 'app_seq' },
          grantee: 'PUBLIC',
          grantor: 'postgres',
          words: ['usage'],
        },
      ],
    });
    const props: PostgresGrantsProps = { ...baseProps, revokeFromPublic: true };
    const attrs = await run(reconcileWithClient(fake, props, undefined));
    // REVOKE ALL ON ALL TABLES IN SCHEMA does not reach sequences (measured), so the
    // sequence's PUBLIC grant is never counted: the reconcile converges without any
    // PUBLIC statement, and the recorded fact stays relkind-scoped.
    expect(writesOf(fake)).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'GRANT usage ON SCHEMA "app" TO "seat_writer"',
    ]);
    expect(attrs.publicSchemaRevoked).toBe(true);
    expect(attrs.publicTablesRevoked).toBe(true);
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    await run(reconcileWithClient(fake, props, attrs));
    expect(fake.statements.filter((s) => isWrite(s.text)).length).toBe(writesBefore);
  });
});

describe('reconcile: multi-word column grants land on the column, not the table', () => {
  test('a two-word column declaration converges and leaves no table-level grant', async () => {
    const fake = makeFakeGrants(catalog);
    const props: PostgresGrantsProps = {
      ...baseProps,
      columnGrants: [{ table: 'widgets', column: 'id', privileges: ['select', 'update'] }],
    };
    const attrs = await run(reconcileWithClient(fake, props, undefined));
    // Each word carries its own column list, so `select` and `update` both land on the
    // column and nothing lands on the relation — the re-read projection proves it.
    expect(attrs.columns).toEqual([
      { table: 'widgets', column: 'id', privileges: ['select', 'update'] },
    ]);
    expect(attrs.tables).toEqual([]);
    // The statement that got the words there is the synopsis repeat, not a word list under
    // one trailing column list (which PG 18.6 reads as a table-level grant of all but the last).
    expect(writesOf(fake)).toContain(
      'GRANT select ("id"), update ("id") ON "app"."widgets" TO "seat_writer"',
    );
    // A re-run with the projection back in is a no-op — the shape converges.
    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    await run(reconcileWithClient(fake, props, attrs));
    expect(fake.statements.filter((s) => isWrite(s.text)).length).toBe(writesBefore);
  });
});

describe('fake parser: the single-trailing-column-list shape is refused', () => {
  test('a word list under one column list is not a column grant', () => {
    // On PG 18.6 this is a table-level SELECT plus a column-level UPDATE; the builders
    // never emit it, so the parser must not file it as a column-only grant.
    expect(parseGrantStatement('GRANT select, update ("id") ON "app"."widgets" TO "seat"')).toBe(
      undefined,
    );
  });

  test('the synopsis-repeat shape parses as one column grant with every word', () => {
    const parsed = parseGrantStatement(
      'GRANT select ("id"), update ("id") ON "app"."widgets" TO "seat"',
    );
    expect(parsed).toEqual({
      kind: 'grant',
      object: { schema: 'app', table: 'widgets', column: 'id' },
      grantee: 'seat',
      words: ['select', 'update'],
      option: false,
    });
  });

  test('mixed columns in one statement are refused', () => {
    expect(
      parseGrantStatement('GRANT select ("id"), update ("name") ON "app"."widgets" TO "seat"'),
    ).toBe(undefined);
  });
});
