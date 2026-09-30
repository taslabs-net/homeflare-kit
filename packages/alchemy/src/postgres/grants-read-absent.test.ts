/**
 * The two faces of `read`'s ABSENT answer, replayed against the fake server model: a
 * target that holds nothing and has NO stored output reads as absent (that is a first
 * create, never the adoption of an empty schema — H1), while the same all-empty catalog on
 * the update path — the resource already has applied state — is a real projection (the
 * grantee may own everything outright, so `aclexplode` has no rows), so `read` must not
 * flip the next apply back into a first create. Extracted from
 * `grants-lifecycle-guards.test.ts` to keep both files under the code-size cap.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeGrants } from './fake-grants-sql.ts';
import { readWithClient } from './grants-ops.ts';
import type { PgContext } from './connection.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const context: PgContext = { database: 'agents' };

/** The seat model: `notes` (with its column) and its catalog are the seat's OWN objects;
 * `shared` is someone else's. The schema is still owned by the executor. */
const ownedCatalog = {
  schemas: ['app'],
  roles: ['postgres', 'seat_writer'],
  tables: [
    { schema: 'app', table: 'notes', owner: 'seat_writer', columns: ['id'] },
    { schema: 'app', table: 'shared' },
  ],
};

describe('read: an empty target is absent', () => {
  test('answers undefined when the role holds nothing anywhere', async () => {
    const fake = makeFakeGrants(ownedCatalog);
    const live = await run(
      readWithClient(
        fake,
        {
          role: 'seat_writer',
          database: 'agents',
          schema: 'app',
          tables: ['notes', 'shared'],
          columns: [{ table: 'notes', column: 'id' }],
          defaults: [],
        },
        context,
        false,
      ),
    );
    // A first create, never an adoption of an empty schema: only grants mark the target
    // as live, so the stack declares this grant set with adopt(true) when it is already
    // applied and without it on a first deploy.
    expect(live).toBeUndefined();
  });

  test('answers the projection when stored output exists and the role holds nothing', async () => {
    const fake = makeFakeGrants(ownedCatalog);
    const live = await run(
      readWithClient(
        fake,
        {
          role: 'seat_writer',
          database: 'agents',
          schema: 'app',
          tables: ['notes', 'shared'],
          columns: [{ table: 'notes', column: 'id' }],
          defaults: [],
        },
        context,
        true,
      ),
    );
    // The update path: the resource already has applied state, so an all-empty read is a
    // real answer — the grantee owns everything outright and `aclexplode` has no rows —
    // not an absent target. Answering undefined here would flip the next apply into a
    // first create. The projection still names the declared objects with empty word
    // lists, the way the reconcile's output does for owned tables.
    expect(live).toEqual({
      role: 'seat_writer',
      database: 'agents',
      schema: 'app',
      schemaOwnedByRole: false,
      schemaPrivileges: [],
      tables: [
        { table: 'notes', privileges: [] },
        { table: 'shared', privileges: [] },
      ],
      columns: [{ table: 'notes', column: 'id', privileges: [] }],
      defaults: [],
      // PUBLIC holds no rows at all in this all-empty ACL, so both revoked flags answer
      // true: the projection reports the absence the same way reconcile's output does.
      publicSchemaRevoked: true,
      publicTablesRevoked: true,
      ownedTables: ['notes'],
    });
  });
});
