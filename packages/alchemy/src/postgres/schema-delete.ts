/**
 * `Postgres.Schema`'s drop path: prove the connection, prove the schema is still ours, then
 * ONE atomic statement that re-proves it under a lock and drops (`schema-drop-sql.ts`).
 *
 * ⛔ THE ENGINE DOES NOT RE-READ BEFORE A DELETE THAT HAS STATE (alchemy `Apply.ts`). When
 *   persisted attributes exist, `delete` receives the LAST asserted `oid` + `owner` and no
 *   fresh row — a schema dropped out of band and recreated under the same name by another role
 *   would be dropped by name, `CASCADE` included, destroying their objects.
 *   `deleteWithClient` re-reads `pg_namespace` first: absent is idempotent success, and a live
 *   row that no longer matches the persisted proof fails with
 *   `PostgresSchemaDeleteForeignRefused` (`schema-assert.ts#deleteForeignRefusal`) before any
 *   `DROP` is issued.
 * ⛔ THE RE-READ ALONE IS A WINDOW. It is a separate autocommit statement (a separate `psql` on
 *   the runner transport), so the schema can change between the read and the drop. The drop
 *   therefore carries the proven `oid` + `owner` INTO one `DO` block that locks, re-verifies
 *   them, checks emptiness or cross-schema dependents, and drops in one transaction. This
 *   file's read is the typed, readable refusal; the block is the guarantee.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { assertDatabase, deleteForeignRefusal } from './schema-assert.ts';
import {
  PostgresSchemaCascadeCrossSchemaRefused,
  PostgresSchemaDeleteForeignRefused,
  PostgresSchemaDropNotEmptyError,
  type PostgresSchemaWrongDatabase,
} from './schema-errors.ts';
import {
  CASCADE_SEQUENCES,
  CROSS_SCHEMA_DEPENDENTS,
  IDENTITY_CHANGED,
  NOT_EMPTY,
  buildAtomicDropSql,
  dependentsCount,
  sqlStateOf,
} from './schema-drop-sql.ts';
import { PostgresSchemaCascadeSequencesRefused, sequencesCount } from './schema-sequence-error.ts';
import { isDependentObjectsError, selectSchema } from './schema-sql.ts';

type DropError =
  | PostgresSchemaDropNotEmptyError
  | PostgresSchemaCascadeCrossSchemaRefused
  | PostgresSchemaCascadeSequencesRefused
  | PostgresSchemaDeleteForeignRefused
  | SqlError;

/**
 * The atomic guarded `DROP SCHEMA` for a row the caller has already read, against any
 * {@link PgExecutor}. The server's refusals come back as typed tags: `HF001` (the row changed
 * between read and drop) re-reads and refuses as a foreign schema; `HF002` and the server's own
 * `2BP01` (an object kind the emptiness check's four catalogs miss) are the not-empty tag;
 * `HF003` is the cross-schema dependents refusal, with the count only; `HF004` refuses a cascade
 * over a schema holding a sequence.
 */
const dropAtomic = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
  live: PostgresSchemaAttributes,
): Effect.Effect<void, DropError> => {
  const cascade = props.cascade === true;
  const classify = (error: SqlError): Effect.Effect<void, DropError> => {
    const state = sqlStateOf(error);
    if (state === NOT_EMPTY || (!cascade && isDependentObjectsError(error))) {
      return Effect.fail(new PostgresSchemaDropNotEmptyError({ schema: props.name }));
    }
    if (state === CROSS_SCHEMA_DEPENDENTS) {
      return Effect.fail(
        new PostgresSchemaCascadeCrossSchemaRefused({
          schema: props.name,
          dependents: dependentsCount(error),
        }),
      );
    }
    if (state === CASCADE_SEQUENCES) {
      return Effect.fail(
        new PostgresSchemaCascadeSequencesRefused({
          schema: props.name,
          sequences: sequencesCount(error),
        }),
      );
    }
    if (state === IDENTITY_CHANGED) {
      return Effect.flatMap(selectSchema(pg, props.name), (now) =>
        now === undefined
          ? Effect.void
          : Effect.fail(
              new PostgresSchemaDeleteForeignRefused({
                schema: props.name,
                database: props.database,
                liveOid: now.oid,
                liveOwner: now.owner,
                lastOid: live.oid,
                lastOwner: live.owner,
              }),
            ),
      );
    }
    return Effect.fail(error);
  };
  return pg
    .unsafe(buildAtomicDropSql({ name: props.name, oid: live.oid, owner: live.owner, cascade }))
    .pipe(Effect.asVoid, Effect.catchTag('SqlError', classify));
};

/** Prove the connected database, then the guarded drop of whatever row is live now — the drop
 * core on its own, for the tests that drive it directly. No persisted proof is consulted: the
 * row read here is the row the atomic drop re-verifies. */
export const dropWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
): Effect.Effect<void, PostgresSchemaWrongDatabase | DropError> =>
  Effect.gen(function* () {
    yield* assertDatabase(props, pg);
    const live = yield* selectSchema(pg, props.name);
    if (live === undefined) return;
    yield* dropAtomic(pg, props, live);
  });

/**
 * The core of `delete`: re-read first (see the file header), refuse a schema the persisted
 * proof cannot vouch for, then the atomic guarded drop. `output` is the persisted state the
 * engine hands over — `undefined` is no proof and refuses too.
 */
export const deleteWithClient = (
  pg: PgExecutor,
  props: PostgresSchemaProps,
  output: PostgresSchemaAttributes | undefined,
): Effect.Effect<void, PostgresSchemaWrongDatabase | DropError> =>
  Effect.gen(function* () {
    yield* assertDatabase(props, pg);
    const live = yield* selectSchema(pg, props.name);
    if (live === undefined) return;
    const refusal = deleteForeignRefusal(props, live, output);
    if (refusal !== undefined) return yield* Effect.fail(refusal);
    yield* dropAtomic(pg, props, live);
  });
