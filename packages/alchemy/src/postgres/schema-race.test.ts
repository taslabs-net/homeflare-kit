/**
 * The `IF NOT EXISTS` race the lifecycle test does not pin: a concurrent creator wins
 * between the not-found `SELECT` and `CREATE SCHEMA`, and the re-read finds their row.
 *
 * Two shapes the existing race test skips. A declared comment must not `COMMENT ON` that
 * row before the drift refusal — the kit role is superuser, so the comment would land and
 * a failed effect would not roll it back. An omitted `owner` must not adopt the foreign
 * row: a fresh `CREATE` without `AUTHORIZATION` is owned by `current_user`, and a mismatch
 * is `PostgresSchemaDrift`, never a returned row a later `RemovalPolicy.destroy()` could drop.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { PostgresSchemaDrift } from './schema-errors.ts';
import { reconcileWithClient } from './schema.ts';

const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

describe('IF NOT EXISTS race, the shapes the owner-only test skips', () => {
  test('a race plus a declared comment issues zero COMMENT ON', async () => {
    const fake = makeFakeSql({ roles: ['seat_role'], raceNextCreateSchema: 'other_role' });
    const error = await fails(
      reconcileWithClient(fake, {
        name: 'ledger',
        database: 'postgres',
        owner: 'seat_role',
        comment: 'seat ledger',
      }),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDrift);
    expect((error as PostgresSchemaDrift).prop).toBe('owner');
    expect((error as PostgresSchemaDrift).live).toBe('other_role');
    expect(fake.statements.some((s) => s.text.startsWith('COMMENT ON SCHEMA'))).toBe(false);
    // The foreign row is untouched: comment still absent, owner still the racer's.
    expect(fake.schemas.get('ledger')?.comment).toBeNull();
    expect(fake.schemas.get('ledger')?.owner).toBe('other_role');
  });

  test('a race plus an omitted owner fails drift and does not return the foreign row', async () => {
    // `current_user` is `seat_role`, not the fake's historical `'postgres'` default, so a
    // hardcoded owner cannot satisfy `declared`.
    const fake = makeFakeSql({
      roles: ['seat_role'],
      raceNextCreateSchema: 'other_role',
      currentUser: 'seat_role',
    });
    const error = await fails(reconcileWithClient(fake, { name: 'ledger', database: 'postgres' }));
    expect(error).toBeInstanceOf(PostgresSchemaDrift);
    const drift = error as PostgresSchemaDrift;
    expect(drift.prop).toBe('owner');
    expect(drift.live).toBe('other_role');
    expect(drift.declared).toBe('seat_role');
    expect(fake.schemas.get('ledger')?.owner).toBe('other_role');
  });

  test('a later plan sees the foreign row as already present and still refuses it', async () => {
    // The failed race leaves the racer's schema in place. The next reconcile takes the
    // already-present path, which must drift too — otherwise that plan adopts the row.
    const fake = makeFakeSql({
      currentUser: 'seat_role',
      schemas: [
        {
          name: 'ledger',
          database: 'postgres',
          oid: 30000,
          owner: 'other_role',
          comment: null,
        },
      ],
    });
    const error = await fails(reconcileWithClient(fake, { name: 'ledger', database: 'postgres' }));
    expect(error).toBeInstanceOf(PostgresSchemaDrift);
    expect((error as PostgresSchemaDrift).prop).toBe('owner');
    expect((error as PostgresSchemaDrift).declared).toBe('seat_role');
    expect(fake.statements.some((s) => s.text.startsWith('CREATE SCHEMA'))).toBe(false);
    expect(fake.statements.some((s) => s.text.startsWith('COMMENT ON SCHEMA'))).toBe(false);
  });
});
