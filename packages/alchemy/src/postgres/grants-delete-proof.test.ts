/**
 * The delete-path convergence proof (S10): `delete` runs its revokes, then re-reads and
 * re-plans the way `reconcile` does. A clean revoke converges silently; a third grantor's
 * grant the executor's REVOKE cannot clear survives the pass and fails loud with the
 * still-planned statements (`PostgresGrantsRepairRefused`) instead of reporting a delete
 * that left the grantee holding privileges. The fake's server rule — `REVOKE ALL` removes
 * only the executing role's own grants — is the survival the proof must catch.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { deleteWithClient, reconcileWithClient } from './grants-ops.ts';
import { PostgresGrantsRepairRefused } from './grants-errors.ts';
import { readGrants } from './grants-read.ts';
import type { PostgresGrantsProps } from './grants-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const isWrite = (text: string): boolean => /^(GRANT|REVOKE|ALTER)/.test(text);

const baseProps: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  schemaUsage: true,
};

/** The catalog a delete needs: the schema and grantee role exist, and one table with a
 * column so table and column grants have a target. */
const catalog = {
  schemas: ['app'],
  roles: ['postgres', 'seat_writer'],
  tables: [{ schema: 'app', table: 'widgets', columns: ['id'] }],
};

describe('delete: the re-read proof', () => {
  test('a clean delete runs the revokes and converges silently', async () => {
    const fake = makeFakeGrants(catalog);
    await run(
      reconcileWithClient(
        fake,
        {
          ...baseProps,
          tables: [{ table: 'widgets', privileges: ['select'] }],
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
    // Only the revokes, no re-grant, no second-pass writes: the re-read found nothing.
    expect(
      fake.statements
        .slice(before)
        .map((s) => s.text)
        .filter(isWrite),
    ).toEqual([
      'REVOKE ALL ON SCHEMA "app" FROM "seat_writer"',
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
    ]);
  });

  test('a delete re-grants the undeclared column entries its table revoke collaterally clears', async () => {
    // The seat's own column grant on `qty` was never declared, but a table-level
    // `REVOKE ALL` clears it too. `delete` takes away what the declaration managed and leaves
    // everything else exactly as it was, so the column grant IS re-granted in the same pass
    // (the same collateral the reconcile path restores, grants-plan.ts `restoredColumnGrants`).
    const fake = makeFakeGrants({
      schemas: ['app'],
      roles: ['postgres', 'seat_writer'],
      tables: [{ schema: 'app', table: 'widgets', columns: ['qty'] }],
      acl: [
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
    // The table revoke, then the collateral column re-grant — no schema grant was seeded, and
    // the undeclared `qty` entry survives the delete.
    expect(writes).toEqual([
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
      'GRANT update ("qty") ON "app"."widgets" TO "seat_writer"',
    ]);
    const after = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(after.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: ['update'] },
    ]);
  });

  test('a third grantor\u2019s surviving grant fails the delete as PostgresGrantsRepairRefused', async () => {
    const fake = makeFakeGrants(catalog);
    await run(
      reconcileWithClient(
        fake,
        { ...baseProps, tables: [{ table: 'widgets', privileges: ['select'] }] },
        undefined,
      ),
    );
    // The competing grant lands after the converge (a third grantor grants while the seat
    // already holds the executor's grant): the delete's REVOKE clears only the executor's
    // own grants, so this one survives the pass and the delete's re-read must catch it.
    fake.acl.push({
      object: { schema: 'app', table: 'widgets' },
      grantee: 'seat_writer',
      grantor: 'someone_else',
      words: ['delete'],
    });
    const before = fake.statements.length;
    const error = await fails(
      deleteWithClient(fake, {
        ...baseProps,
        tables: [{ table: 'widgets', privileges: ['select'] }],
      }),
    );
    expect(error).toBeInstanceOf(PostgresGrantsRepairRefused);
    // The third grantor's 'delete' survived the revoke, so the re-read still plans the
    // table's REVOKE — that surviving statement is the refusal.
    expect((error as PostgresGrantsRepairRefused).remaining).toContain(
      'REVOKE ALL ON "app"."widgets" FROM "seat_writer"',
    );
    expect(
      fake.statements
        .slice(before)
        .map((s) => s.text)
        .filter(isWrite),
    ).toContain('REVOKE ALL ON "app"."widgets" FROM "seat_writer"');
  });
});
