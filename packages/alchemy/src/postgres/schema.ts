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
 * ⛔ `delete` DROPS ONLY WHEN SAFE. `DROP SCHEMA` refuses a non-empty schema unless
 *   `cascade: true` is declared (`PostgresSchemaDropNotEmptyError`); the `cascade` prop
 *   defaults to `false` (retain policy by default — see `defaultRemovalPolicy: 'retain'`).
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import {
  type PostgresSchemaAttributes,
  type PostgresSchemaProps,
  normalizedComment,
} from './schema-attrs.ts';
import { schemaNameByteRefusal } from './schema-attrs.ts';
import { diffPostgresSchema } from './schema-diff.ts';
import { assertLive, assertOwner } from './schema-assert.ts';
import {
  buildCommentSchemaSql,
  buildCreateSchemaSql,
  buildDropSchemaSql,
  currentDatabase,
  currentUser,
  isDependentObjectsError,
  schemaIsEmpty,
  selectSchema,
} from './schema-sql.ts';
import { roleExists } from './database-sql.ts';
import type { PgExecutor } from './database-sql.ts';
import { type PostgresConnection, withPg } from './connection.ts';
import {
  PostgresSchemaCreateVanished,
  type PostgresSchemaDrift,
  PostgresSchemaDropNotEmptyError,
  PostgresSchemaNameRefused,
  PostgresSchemaOwnerMissing,
  PostgresSchemaWrongDatabase,
} from './schema-errors.ts';

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

/** The connected database, proven equal to the declaration or refused — the guard every write
 * path in this family runs first. */
const assertDatabase = (
  props: PostgresSchemaProps,
  pg: PgExecutor,
): Effect.Effect<void, PostgresSchemaWrongDatabase | SqlError> =>
  Effect.flatMap(currentDatabase(pg), (connected) =>
    connected === props.database
      ? Effect.void
      : Effect.fail(
          new PostgresSchemaWrongDatabase({
            schema: props.name,
            declared: props.database,
            connected,
          }),
        ),
  );

/**
 * The core of `reconcile`, against any {@link PgExecutor} — the real pooled client through
 * `withPg`, or `fake-sql.ts`'s recording fake in tests.
 */
export const reconcileWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
): Effect.Effect<
  PostgresSchemaAttributes,
  | PostgresSchemaWrongDatabase
  | PostgresSchemaOwnerMissing
  | PostgresSchemaDrift
  | PostgresSchemaCreateVanished
  | SqlError
> =>
  Effect.gen(function* () {
    yield* assertDatabase(props, pg);
    // Only an omitted owner needs the session role: a declared owner is the comparison itself.
    const executingRole = props.owner !== undefined ? props.owner : yield* currentUser(pg);
    const observed = yield* selectSchema(pg, props.name);
    if (observed === undefined) {
      if (props.owner !== undefined) {
        const ownerPresent = yield* roleExists(pg, props.owner);
        if (!ownerPresent) {
          return yield* Effect.fail(
            new PostgresSchemaOwnerMissing({ schema: props.name, owner: props.owner }),
          );
        }
      }
      yield* pg.unsafe(buildCreateSchemaSql(props)).pipe(Effect.asVoid);
      // Never trust the write's own report (S10): re-read what the server actually stored.
      const created = yield* selectSchema(pg, props.name);
      if (created === undefined) {
        return yield* Effect.fail(new PostgresSchemaCreateVanished({ schema: props.name }));
      }
      // Owner before COMMENT ON (schema-assert.ts): a race winner is refused here, so their
      // schema is never commented.
      yield* assertOwner(props, created, executingRole);
      const comment = normalizedComment(props.comment);
      if (comment !== undefined && comment !== (created.comment ?? undefined)) {
        yield* pg.unsafe(buildCommentSchemaSql(props.name, comment)).pipe(Effect.asVoid);
        const commented = yield* selectSchema(pg, props.name);
        if (commented === undefined) {
          return yield* Effect.fail(new PostgresSchemaCreateVanished({ schema: props.name }));
        }
        return yield* assertLive(props, commented, executingRole);
      }
      return yield* assertLive(props, created, executingRole);
    }
    return yield* assertLive(props, observed, executingRole);
  });

/** The core of `read`: one bound `SELECT`, no ownership branding. */
export const readWithClient = (pg: PgExecutor, name: string) => selectSchema(pg, name);

/** The core of `drop`, against any {@link PgExecutor}: proves the connected database, refuses a
 * non-empty schema without `cascade`, then issues one idempotent `DROP SCHEMA` — with the
 * server's own `2BP01` refusal classified as the same typed tag for an object kind the
 * emptiness check's catalogs do not cover. */
export const dropWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
): Effect.Effect<void, PostgresSchemaWrongDatabase | PostgresSchemaDropNotEmptyError | SqlError> =>
  Effect.gen(function* () {
    yield* assertDatabase(props, pg);
    if (props.cascade !== true) {
      const empty = yield* schemaIsEmpty(pg, props.name);
      if (!empty) {
        return yield* Effect.fail(new PostgresSchemaDropNotEmptyError({ schema: props.name }));
      }
    }
    // The server's own `2BP01` refusal (an object kind the four catalogs miss) is classified
    // into the same typed tag the emptiness check raises — one fail branch, classified before
    // the fail, exactly as `database-sql.ts` classifies the `42P04` race.
    const dropRefusal = (error: SqlError): PostgresSchemaDropNotEmptyError | SqlError =>
      props.cascade !== true && isDependentObjectsError(error)
        ? new PostgresSchemaDropNotEmptyError({ schema: props.name })
        : error;
    yield* pg.unsafe(buildDropSchemaSql(props.name, props.cascade === true)).pipe(
      Effect.asVoid,
      Effect.catchTag('SqlError', (error) => Effect.fail(dropRefusal(error))),
    );
  });

export { diffPostgresSchema } from './schema-diff.ts';

/** The five lifecycle handlers. Exported on its own so a test drives the real implementation. */
export const postgresSchemaHandlers = PostgresSchema.Provider.of({
  // ⚠️ EMPTY, NOT A LIVE SWEEP — same reasoning as Postgres.Database's list.
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ olds, output }) =>
    Effect.gen(function* () {
      const name = output?.name ?? olds.name;
      const database = output?.database ?? olds.database;
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
      return live === undefined ? undefined : Unowned(live);
    }),

  diff: ({ news, output, olds }) => diffPostgresSchema(news, output, olds),

  reconcile: ({ news }) =>
    Effect.gen(function* () {
      const nameRefusal = schemaNameByteRefusal(news.name);
      if (nameRefusal !== undefined) {
        return yield* Effect.fail(
          new PostgresSchemaNameRefused({ name: news.name, ...nameRefusal }),
        );
      }
      return yield* withPg((pg) => reconcileWithClient(pg, news), news.database);
    }),

  delete: ({ olds }) => withPg((pg) => dropWithClient(pg, olds), olds.database),
});

export const PostgresSchemaProvider = () =>
  Provider.succeed(PostgresSchema, postgresSchemaHandlers);
