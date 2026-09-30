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
import { planRepair } from './grants-plan.ts';
import { resolveProps } from './grants-declare.ts';
import { readGrants } from './grants-read.ts';
import { reconcileWithClient } from './grants-ops.ts';
import type { PgContext } from './connection.ts';
import type { PostgresGrantsProps } from './grants-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const context: PgContext = { database: 'agents' };

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
    const attrs = await run(reconcileWithClient(fake, props, undefined, context));

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
      { table: 'widgets', column: 'qty', role: ['update'], public: ['select'] },
    ]);

    const writesBefore = fake.statements.filter((s) => isWrite(s.text)).length;
    await run(reconcileWithClient(fake, props, attrs, context));
    expect(fake.statements.filter((s) => isWrite(s.text)).length).toBe(writesBefore);
  });
});
