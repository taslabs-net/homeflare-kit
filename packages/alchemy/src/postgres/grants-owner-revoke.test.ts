/**
 * The restorable-grantor rule for a table `REVOKE ALL`'s column collateral, driven end to end.
 *
 * ★ THE ENGINE RULE UNDER TEST (`select_best_grantor`, acl.c@REL_18_6): a superuser, the owner
 *   itself, or a member of the owning role performs a `GRANT`/`REVOKE` AS the owner
 *   (`revoke.sgml@REL_18_6`: "the command is performed as though it were issued by the
 *   containing role that actually owns the object"). So the owner's column grant to an
 *   undeclared grantee IS cleared by a table `REVOKE ALL` and must be marked `restorable` —
 *   the repair re-grants it. A non-superuser, non-member revoker clears only grants it made,
 *   so the owner's grant survives the revoke and must NOT be re-granted (that would stack an
 *   owner grant on top of an entry the revoke never removed).
 * ⚠️ THE OLD CHECK READ `rolsuper` ONLY. A migrator that is a member of the table's owning
 *   role (but not a superuser) revokes as that owner too, so its table revoke cleared the
 *   owner's grant while `revoker_super` said it was not restorable — the grant was dropped.
 *   The read now selects `pg_has_role(current_user, c.relowner, 'USAGE')`, which is true for a
 *   superuser AND for a member of the owning role (`has_privs_of_role`, acl.c@REL_18_6).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { readGrants } from './grants-read.ts';
import { reconcileWithClient } from './grants-ops.ts';
import type { PostgresGrantsProps } from './grants-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const props: PostgresGrantsProps = {
  role: 'seat_writer',
  database: 'agents',
  schema: 'app',
  tables: [{ table: 'widgets', privileges: ['select'] }],
};

/** `widgets` is owned by `admin`; the undeclared `seat_writer` holds `admin`'s `update(qty)`
 * column grant, and the table words drift so a table `REVOKE ALL` is planned. */
const widgetsByAdmin = () => ({
  schemas: ['app'],
  roles: ['postgres', 'seat', 'admin', 'migrator', 'seat_writer'],
  tables: [{ schema: 'app', table: 'widgets', columns: ['qty'], owner: 'admin' }],
});

const adminGrant = {
  object: { schema: 'app', table: 'widgets', column: 'qty' },
  grantee: 'seat_writer',
  grantor: 'admin',
  words: ['update'],
} as const;

const qtyGrantors = (fake: ReturnType<typeof makeFakeGrants>): ReadonlyArray<string> =>
  fake.acl
    .filter((entry) => entry.object.column === 'qty' && entry.grantee === 'seat_writer')
    .map((entry) => entry.grantor);

describe('a revoker that acts as the owner restores the owner\u2019s column grant', () => {
  test('a non-superuser, non-member connection leaves the owner\u2019s grant alone and converges', async () => {
    const fake = makeFakeGrants({
      ...widgetsByAdmin(),
      executor: 'seat',
      executorSuper: false,
      acl: [adminGrant],
    });
    const live = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(live.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: [] },
    ]);
    await run(reconcileWithClient(fake, props, undefined));
    const after = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(after.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: [] },
    ]);
    // The revoke never removed the admin grant, and the repair did not stack a seat grant.
    expect(qtyGrantors(fake)).toEqual(['admin']);
  });

  test('a member of the owning role revokes as the owner: the owner\u2019s grant survives a repair', async () => {
    // `migrator` is a non-superuser member of `admin`, which owns `widgets`. Its table
    // `REVOKE ALL` is performed as `admin` (revoke.sgml), so `admin`'s `update(qty)` grant is
    // cleared and must be restored — the exact case the old `revoker_super` check missed.
    const fake = makeFakeGrants({
      ...widgetsByAdmin(),
      executor: 'migrator',
      executorSuper: false,
      executorMemberships: ['admin'],
      acl: [adminGrant],
    });
    const live = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(live.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: ['update'] },
    ]);
    await run(reconcileWithClient(fake, props, undefined));
    const after = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(after.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: ['update'] },
    ]);
    // The repair re-granted the cleared grant AS the owner (admin), not as a stacked migrator
    // grant on top of an entry the revoke left behind.
    expect(qtyGrantors(fake)).toEqual(['admin']);
  });

  test('a superuser connection revokes as the owner and the repair restores the owner\u2019s grant', async () => {
    // The grant predates the superuser promotion: `admin` granted `update(qty)` before the
    // revoker became a superuser, and `pg_has_role(..., 'USAGE')` answers on the CURRENT
    // status, so the grant is restorable regardless of when it was made.
    const fake = makeFakeGrants({
      ...widgetsByAdmin(),
      executor: 'postgres',
      executorSuper: true,
      acl: [adminGrant],
    });
    const live = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(live.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: ['update'] },
    ]);
    await run(reconcileWithClient(fake, props, undefined));
    const after = await run(readGrants(fake, 'app', 'seat_writer'));
    expect(after.columns).toEqual([
      { table: 'widgets', column: 'qty', role: ['update'], public: [], restorable: ['update'] },
    ]);
    expect(qtyGrantors(fake)).toEqual(['admin']);
  });
});
