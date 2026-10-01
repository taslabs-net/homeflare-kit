/**
 * Regression for the review finding: the server's table-level `REVOKE ALL` clears the
 * grantee's column entries on that table — ALL of them, including columns the declaration
 * does not name. The planner re-granted only the DECLARED columns of a revoked table, so a
 * column grant the declaration never mentioned was stripped by a table-words repair and
 * never restored — the seat silently lost a grant the resource promised never to touch
 * ("an object the declaration does not name is NEVER touched", grants-declare.ts). The
 * repair now re-grants every live column entry on a revoked table the declaration does not
 * name, as it was read, in the same pass; PUBLIC column words are untouched, because a
 * revoke from the seat role never clears PUBLIC's entries (a different grantee).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { planReconcile, planRepair } from './grants-plan.ts';
import { resolveProps } from './grants-declare.ts';
import { readGrants } from './grants-read.ts';
import { reconcileWithClient } from './grants-ops.ts';
import type { PostgresGrantsProps } from './grants-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

/** `widgets` carries an executor-granted UPDATE on column `qty` — the seat's own grant the
 * declaration never names, plus PUBLIC's — exactly what a table repair used to strip. */
const catalog = {
  schemas: ['app'],
  roles: ['postgres', 'seat_writer'],
  tables: [{ schema: 'app', table: 'widgets', columns: ['id', 'qty'] }],
  acl: [
    {
      object: { schema: 'app', table: 'widgets', column: 'qty' },
      grantee: 'seat_writer',
      grantor: 'postgres',
      words: ['update'],
    },
    {
      object: { schema: 'app', table: 'widgets', column: 'qty' },
      grantee: 'PUBLIC',
      grantor: 'postgres',
      words: ['select'],
    },
  ],
};

const props: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  tables: [{ table: 'widgets', privileges: ['select'] }],
};

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

describe('planRepair: a table revoke preserves the column grants it collaterally clears', () => {
  test('every undeclared column entry on the revoked table is re-granted as it was read', async () => {
    const fake = makeFakeGrants(catalog);
    const live = await run(readGrants(fake, 'app', 'seat_writer'));
    // The table drifts (live role words are empty), so a REVOKE ALL on widgets is
    // planned — and the undeclared qty words must ride along in the same pass. PUBLIC's
    // qty words appear nowhere: a revoke from the seat role is not PUBLIC's business.
    const statements = planRepair(resolveProps(props), live);
    expect(statements).toContain('GRANT update ("qty") ON "app"."widgets" TO "seat_writer"');
    expect(statements).not.toContain('GRANT select ("qty") ON "app"."widgets" TO PUBLIC');
  });
});

describe('reconcile: the undeclared column grant survives a table-words repair', () => {
  test('the repair converges in one pass and leaves the undeclared grant exactly as it was', async () => {
    const fake = makeFakeGrants(catalog);
    const attrs = await run(reconcileWithClient(fake, props, undefined));

    expect(fake.statements.map((s) => s.text).filter(isWrite)).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'GRANT usage ON SCHEMA "app" TO "seat_writer"',
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'GRANT select ON "app"."widgets" TO "seat_writer"',
      'GRANT update ("qty") ON "app"."widgets" TO "seat_writer"',
    ]);
    // The undeclared column never appears in the recorded state (the projection keeps
    // only declared names), yet its grant is still live after the repair.
    expect(attrs.columns).toEqual([]);
    const after = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(after.columns).toEqual([
      {
        table: 'widgets',
        column: 'qty',
        role: ['update'],
        public: ['select'],
        restorable: ['update'],
      },
    ]);

    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    await run(reconcileWithClient(fake, props, attrs));
    expect(fake.statements.filter((s) => isWrite(s.text)).length).toBe(writesBefore);
  });

  test('a third grantor\u2019s column grant is left in place — re-granting would add an owner grant on top', async () => {
    const fake = makeFakeGrants({
      schemas: ['app'],
      roles: ['postgres', 'seat_writer', 'someone_else'],
      tables: [{ schema: 'app', table: 'widgets', columns: ['id', 'qty'] }],
      acl: [
        {
          object: { schema: 'app', table: 'widgets', column: 'qty' },
          grantee: 'seat_writer',
          grantor: 'someone_else',
          words: ['update'],
        },
      ],
    });
    await run(reconcileWithClient(fake, props, undefined));
    expect(fake.statements.map((s) => s.text).filter(isWrite)).not.toContain(
      'GRANT update ("qty") ON "app"."widgets" TO "seat_writer"',
    );
    expect(
      fake.acl
        .filter((entry) => entry.object.column === 'qty' && entry.grantee === 'seat_writer')
        .map((entry) => entry.grantor),
    ).toEqual(['someone_else']);
  });
});

describe('removing a table restores the column grants its REVOKE clears', () => {
  test('an out-of-band column grant survives dropping the table, in the same transaction', async () => {
    const fake = makeFakeGrants({
      schemas: ['app'],
      roles: ['postgres', 'seat_writer'],
      tables: [{ schema: 'app', table: 'widgets', columns: ['qty'] }],
      acl: [
        {
          object: { schema: 'app' },
          grantee: 'seat_writer',
          grantor: 'postgres',
          words: ['usage'],
        },
        {
          object: { schema: 'app', table: 'widgets' },
          grantee: 'seat_writer',
          grantor: 'postgres',
          words: ['select'],
        },
        {
          object: { schema: 'app', table: 'widgets', column: 'qty' },
          grantee: 'seat_writer',
          grantor: 'postgres',
          words: ['update'],
        },
      ],
    });
    const kept = await run(reconcileWithClient(fake, props, undefined));
    const before = fake.transactions.length;
    await run(reconcileWithClient(fake, { ...props, tables: [] }, kept));
    const revoke = 'REVOKE ALL ON "app"."widgets" FROM "seat_writer"';
    const grant = 'GRANT update ("qty") ON "app"."widgets" TO "seat_writer"';
    expect(fake.transactions.slice(before)).toEqual([[revoke, grant]]);
    const after = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(after.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: ['update'] },
    ]);
  });

  test('the plan re-grants only restorable words, and not a column the update removed', () => {
    const declared = resolveProps({ ...props, tables: [] });
    const live = {
      schemaExists: true,
      schema: { role: ['usage'], public: [] },
      tables: [{ table: 'widgets', relkind: 'r', role: ['select'], public: [] }],
      columns: [
        {
          table: 'widgets',
          column: 'qty',
          role: ['update'],
          public: [],
          restorable: ['update'],
        },
        {
          table: 'widgets',
          column: 'id',
          role: ['select'],
          public: [],
          restorable: ['select'],
        },
      ],
      defaults: [],
      schemaOwnedByRole: false,
      ownedTables: [],
    };
    const removed = {
      schema: 'app',
      role: 'seat_writer',
      tables: [{ table: 'widgets', privileges: [] as ReadonlyArray<string> }],
      columns: [{ table: 'widgets', column: 'id', privileges: [] as ReadonlyArray<string> }],
      defaults: [],
    };
    expect(planReconcile(declared, live, removed)).toEqual([
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'REVOKE ALL ("id") ON "app"."widgets" FROM "seat_writer"',
      'GRANT update ("qty") ON "app"."widgets" TO "seat_writer"',
    ]);
  });
});

describe('a non-superuser connection revokes only its own grants', () => {
  /** `widgets` is owned by `admin`; the executor `seat` is a non-superuser, and the column
   * grant on `qty` was made by `admin` (the owner). A `REVOKE ALL ON TABLE` from `seat`
   * clears only grants `seat` made — `admin`'s column grant survives (`revoke.sgml`), so it
   * must not be marked restorable: re-granting it would add an owner grant on top of an
   * entry the revoke never removed. */
  test('an owner-made column grant is not re-granted by a non-superuser, non-owner connection', async () => {
    const fake = makeFakeGrants({
      schemas: ['app'],
      roles: ['seat', 'admin', 'seat_writer'],
      tables: [{ schema: 'app', table: 'widgets', columns: ['qty'], owner: 'admin' }],
      executor: 'seat',
      executorSuper: false,
      acl: [
        {
          object: { schema: 'app', table: 'widgets', column: 'qty' },
          grantee: 'seat_writer',
          grantor: 'admin',
          words: ['update'],
        },
      ],
    });
    const live = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(live.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: [] },
    ]);
    const statements = planRepair(resolveProps(props), live);
    expect(statements).not.toContain('GRANT update ("qty") ON "app"."widgets" TO "seat_writer"');
  });

  test('the same owner-made grant is restored by a superuser connection, which revokes as the owner', async () => {
    const fake = makeFakeGrants({
      schemas: ['app'],
      roles: ['postgres', 'admin', 'seat_writer'],
      tables: [{ schema: 'app', table: 'widgets', columns: ['qty'], owner: 'admin' }],
      executor: 'postgres',
      executorSuper: true,
      acl: [
        {
          object: { schema: 'app', table: 'widgets', column: 'qty' },
          grantee: 'seat_writer',
          grantor: 'admin',
          words: ['update'],
        },
      ],
    });
    const live = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(live.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: ['update'] },
    ]);
    const statements = planRepair(resolveProps(props), live);
    expect(statements).toContain('GRANT update ("qty") ON "app"."widgets" TO "seat_writer"');
  });
});
