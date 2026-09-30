/**
 * `Postgres.Grants` — one declarative grant set for one role in one schema of one database:
 * schema USAGE/CREATE, per-table privileges, per-column privileges, default privileges for
 * future tables per creator role, and an optional clear of PUBLIC. Computed as a diff
 * against the catalogs (`grants-read.ts`, through `aclexplode`), so a re-run with nothing
 * changed emits nothing, and drift on any NAMED object is repaired. The lifecycle cores
 * against any client live in `grants-ops.ts`; the refusals in `grants-refuse.ts`; the
 * repair plans in `grants-plan.ts` and the offline diff in `grants-diff.ts`.
 *
 * ★ A GRANT SET CARRIES NO OWNERSHIP MARK (H1, same as `Postgres.Database`): `read` answers
 *   `Unowned` for a match, so already-live grants need `adopt(true)` in the stack that
 *   declares them. A target that holds NOTHING anywhere reads as ABSENT — that is a first
 *   create, never an adoption of an empty schema.
 * ★ OBJECTS THE DECLARED ROLE OWNS ARE LEFT ALONE (H2): the owner holds every privilege
 *   implicitly and a `REVOKE` cannot take that away, so the repair and the delete skip
 *   objects the catalogs say the role owns (grants-plan.ts, measured on PG 18.6).
 * ⛔ SCOPE IS EXACTLY THE DECLARATION. Objects the declaration does not name are never
 *   touched; removing an entry from the declaration is a DRIFT the reconcile repairs — the
 *   removed names are revoked before the new declaration's plan runs, so taking an entry
 *   away takes the privilege away. `delete` revokes what the LAST declaration named. PUBLIC
 *   is only ever cleared, only when `revokeFromPublic: true`, and never re-granted.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';
import { declaredNames, namesFromAttrs, resolveProps } from './grants-declare.ts';
import {
  deleteWithClient,
  diffPostgresGrants,
  readWithClient,
  reconcileWithClient,
} from './grants-ops.ts';
import type { PgContext, PostgresConnection } from './connection.ts';
import { withPg } from './connection.ts';

export interface PostgresGrants extends Resource<
  'Postgres.Grants',
  PostgresGrantsProps,
  PostgresGrantsAttributes,
  never,
  PostgresConnection
> {}

export const PostgresGrants = Resource<PostgresGrants>('Postgres.Grants', {
  defaultRemovalPolicy: 'retain',
});

/** Same dual `typeof` guard as `isPostgresDatabase` (see `database.ts` for the measured
 * regression it exists to prevent). */
export const isPostgresGrants = (value: unknown): value is PostgresGrants =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Postgres.Grants';

/** The five lifecycle handlers. Exported on its own so a test drives the real implementation
 * (see `database.ts` for why that matters). */
export const postgresGrantsHandlers = PostgresGrants.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP — the same reasoning as Postgres.Database's list: a sweep of
  //   every ACL row would enumerate grants nothing declared, across every role and schema.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ olds, output }) =>
    Effect.gen(function* () {
      const names =
        output !== undefined ? namesFromAttrs(output) : declaredNames(resolveProps(olds));
      const live = yield* withPg((pg, context) =>
        readWithClient(pg, names, context, output !== undefined),
      );
      return live === undefined ? undefined : Unowned(live);
    }),

  diff: ({ news, output }) => diffPostgresGrants(news, output),

  reconcile: ({ news, output }) =>
    withPg((pg, context: PgContext) => reconcileWithClient(pg, news, output, context)),

  delete: ({ olds }) => withPg((pg, context) => deleteWithClient(pg, olds, context)),
});

export const PostgresGrantsProvider = () =>
  Provider.succeed(PostgresGrants, postgresGrantsHandlers);
