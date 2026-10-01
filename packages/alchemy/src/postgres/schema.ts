/**
 * `Postgres.Schema` — create-and-assert over one schema in a self-hosted PostgreSQL 18 cluster.
 *
 * ★ A SCHEMA CARRIES NO OWNERSHIP MARK, exactly like `Postgres.Database` (H1). `read` answers
 *   `Unowned` for a match, so every already-live schema needs `adopt(true)` in the stack that
 *   declares it.
 * ⛔ NOT ALTER-CAPABLE. `ALTER SCHEMA` only renames or changes owner in Postgres; neither is
 *   implemented. An owner or comment mismatch against the live row is a typed
 *   `PostgresSchemaDrift` refusal, never an `ALTER SCHEMA` — same rule `Postgres.Database`
 *   applies to its own asserted props. An omitted `owner` is compared to `current_user`
 *   (`schema-assert.ts`): a fresh create without `AUTHORIZATION` would be owned by that role.
 * ⛔ THE DECLARED `database` IS PROVEN, NEVER ASSUMED. The family connection points at a
 *   maintenance database (a brand-new database cannot be connected to on a cold plan —
 *   `docs/postgres.md#measured-path`), so the handlers below open `props.database` themselves
 *   (`withPg`'s database override) and `reconcile`/`drop` first compare `current_database()`
 *   against it (`PostgresSchemaWrongDatabase`). Without that proof a seat's schema would be
 *   created in whatever database the single connection happened to target.
 * ⛔ `delete` DROPS ONLY WHAT IT CAN PROVE IT CREATED. Before any `DROP`, the handler re-reads
 *   the live row (`schema-delete.ts`) and matches it against the persisted `oid` + `owner`;
 *   a mismatch is `PostgresSchemaDeleteForeignRefused`, never a `DROP` (`CASCADE` included) —
 *   the schema under that name may be another role's, recreated out of band.
 * ⛔ A MISSING DECLARED DATABASE IS "SCHEMA ABSENT" IN `read` AND `delete`. Both probe
 *   `pg_database` over the family connection first (`database-sql.ts#databaseExists`), so a
 *   cold plan against a not-yet-created database plans a create (`read` answers absent)
 *   instead of failing untyped on connect (`ConnectionError` over psql, `UnknownError` 3D000
 *   over the socket), and a delete of a dropped database stays idempotent. `reconcile` still
 *   requires the database to exist — that ordering is the declaration's job (`docs/
 *   postgres-schema.md`: pass `database: db.name`).
 * ⛔ `delete` DROPS ONLY WHEN SAFE. `DROP SCHEMA` refuses a non-empty schema unless
 *   `cascade: true` is declared (`PostgresSchemaDropNotEmptyError`); the `cascade` prop
 *   defaults to `false` (retain policy by default — see `defaultRemovalPolicy: 'retain'`).
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PostgresSchemaAttributes, type PostgresSchemaProps } from './schema-attrs.ts';
import { schemaNameByteRefusal } from './schema-attrs.ts';
import { diffPostgresSchema } from './schema-diff.ts';
import { selectSchema } from './schema-sql.ts';
import { databaseExists } from './database-sql.ts';
import { reconcileWithClient } from './schema-reconcile.ts';
import { assertSchemaIdentity, assertSchemaTarget } from './schema-identity.ts';
import { deleteWithClient, dropWithClient } from './schema-delete.ts';
import type { PgExecutor } from './database-sql.ts';
import { type PostgresConnection, withPg } from './connection.ts';
import { PostgresSchemaNameRefused, PostgresSchemaWrongDatabase } from './schema-errors.ts';

export interface PostgresSchema extends Resource<
  'Postgres.Schema',
  PostgresSchemaProps,
  PostgresSchemaAttributes,
  never,
  PostgresConnection
> {}

export const PostgresSchema = Resource<PostgresSchema>('Postgres.Schema', {
  defaultRemovalPolicy: 'retain',
});

/** Same dual `typeof` guard as `isPostgresDatabase` (see `database.ts`): a resource constructor
 * is a callable `Object.assign`ed function, not a plain object. */
export const isPostgresSchema = (value: unknown): value is PostgresSchema =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Postgres.Schema';

/** The core of `read`: one bound `SELECT`, no ownership branding. */
export const readWithClient = (pg: PgExecutor, name: string) => selectSchema(pg, name);

export { diffPostgresSchema } from './schema-diff.ts';
export { reconcileWithClient } from './schema-reconcile.ts';
export { deleteWithClient, dropWithClient };

/** The five lifecycle handlers. Exported on its own so a test drives the real implementation. */
export const postgresSchemaHandlers = PostgresSchema.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP — same reasoning as Postgres.Database's list.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ olds, output }) =>
    Effect.gen(function* () {
      const name = output?.name ?? olds.name;
      const database = output?.database ?? olds.database;
      // A declared database that does not exist IS a schema absent. The probe runs over the
      // FAMILY connection (no override), which points at the maintenance database a cold plan
      // can always reach — opening the declared database instead would fail untyped
      // (`ConnectionError` over psql, `UnknownError` 3D000 over the socket).
      const present = yield* withPg((pg) => databaseExists(pg, database));
      if (!present) return undefined;
      const live = yield* withPg((pg) => readWithClient(pg, name), database);
      if (live !== undefined && live.database !== database) {
        return yield* Effect.fail(
          new PostgresSchemaWrongDatabase({
            schema: name,
            declared: database,
            connected: live.database,
          }),
        );
      }
      if (live !== undefined && output !== undefined) yield* assertSchemaIdentity(live, output);
      return live === undefined ? undefined : Unowned(live);
    }),

  diff: ({ news, output, olds }) => diffPostgresSchema(news, output, olds),

  reconcile: ({ news, output }) =>
    Effect.gen(function* () {
      const nameRefusal = schemaNameByteRefusal(news.name);
      if (nameRefusal !== undefined) {
        return yield* Effect.fail(
          new PostgresSchemaNameRefused({ name: news.name, ...nameRefusal }),
        );
      }
      yield* assertSchemaTarget(news, output);
      return yield* withPg((pg) => reconcileWithClient(pg, news, output), news.database);
    }),

  delete: ({ olds, output }) =>
    Effect.gen(function* () {
      // Same missing-database rule as `read`: an absent database is an absent schema, and the
      // delete stays idempotent instead of failing untyped on connect.
      const present = yield* withPg((pg) => databaseExists(pg, olds.database));
      if (!present) return undefined;
      return yield* withPg((pg) => deleteWithClient(pg, olds, output), olds.database);
    }),
});

export const PostgresSchemaProvider = () =>
  Provider.succeed(PostgresSchema, postgresSchemaHandlers);
