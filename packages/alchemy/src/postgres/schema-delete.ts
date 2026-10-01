/**
 * `Postgres.Schema`'s drop path: prove the connection, prove the schema is still ours, then
 * the guarded `DROP SCHEMA`.
 *
 * ⛔ THE ENGINE DOES NOT RE-READ BEFORE A DELETE THAT HAS STATE (alchemy `Apply.ts`). When
 *   persisted attributes exist, `delete` receives the LAST asserted `oid` + `owner` and no
 *   fresh row — a schema dropped out of band and recreated under the same name by another role
 *   would be dropped by name, `CASCADE` included, destroying their objects.
 *   `deleteWithClient` re-reads `pg_namespace` first: absent is idempotent success, and a live
 *   row that no longer matches the persisted proof fails with
 *   `PostgresSchemaDeleteForeignRefused` (`schema-assert.ts#deleteForeignRefusal`) before any
 *   `DROP` is issued.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { assertDatabase, deleteForeignRefusal } from './schema-assert.ts';
import {
  type PostgresSchemaDeleteForeignRefused,
  PostgresSchemaDropNotEmptyError,
  type PostgresSchemaWrongDatabase,
} from './schema-errors.ts';
import {
  buildDropSchemaSql,
  isDependentObjectsError,
  schemaIsEmpty,
  selectSchema,
} from './schema-sql.ts';

/**
 * The guarded `DROP SCHEMA`, against any {@link PgExecutor}: refuses a non-empty schema
 * without `cascade`, and classifies the server's own `2BP01` refusal as the same typed tag —
 * for an object kind the emptiness check's four catalogs do not cover. Callers have already
 * proven the connected database (`assertDatabase`) and, on the delete path, the schema's
 * ownership.
 */
const dropGuarded = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
): Effect.Effect<void, PostgresSchemaDropNotEmptyError | SqlError> =>
  Effect.gen(function* () {
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

/** Prove the connected database, then the guarded drop — the drop core on its own, for the
 * tests that drive it directly. */
export const dropWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
): Effect.Effect<void, PostgresSchemaWrongDatabase | PostgresSchemaDropNotEmptyError | SqlError> =>
  Effect.gen(function* () {
    yield* assertDatabase(props, pg);
    yield* dropGuarded(pg, props);
  });

/**
 * The core of `delete`: re-read first (see the file header), refuse a schema the persisted
 * proof cannot vouch for, then the guarded drop. `output` is the persisted state the engine
 * hands over — `undefined` is no proof and refuses too.
 */
export const deleteWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
  output: PostgresSchemaAttributes | undefined,
): Effect.Effect<
  void,
  | PostgresSchemaWrongDatabase
  | PostgresSchemaDeleteForeignRefused
  | PostgresSchemaDropNotEmptyError
  | SqlError
> =>
  Effect.gen(function* () {
    yield* assertDatabase(props, pg);
    const live = yield* selectSchema(pg, props.name);
    if (live === undefined) return;
    const refusal = deleteForeignRefusal(props, live, output);
    if (refusal !== undefined) return yield* Effect.fail(refusal);
    yield* dropGuarded(pg, props);
  });
