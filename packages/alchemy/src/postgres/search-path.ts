/**
 * The session setup every `Postgres.*` connection runs first: `search_path = pg_catalog, pg_temp`.
 *
 * ⛔ AN UNPINNED SESSION READS ITS OWN CATALOGS THROUGH `search_path`. Postgres searches
 *   `pg_catalog` first only while the path does not NAME it (ddl.sgml 5.10.3); a role- or
 *   database-level `ALTER … SET search_path = public, pg_catalog` (or a path naming any schema
 *   another role may create in) puts a writable schema ahead of it, and a `public.pg_namespace`
 *   TABLE then answers the delete proof's `oid`/`owner` re-read. Found by the Opus read of PR 334
 *   (2026-10-02). The pin makes the order ours whatever the role, database or server says; the SQL
 *   builders ALSO write `pg_catalog.<name>` (`catalog-qualified.test.ts` greps for it), so no
 *   single layer is the whole defence.
 * ★ `pg_temp` goes LAST on purpose: unnamed, it is searched FIRST for relations.
 * ★ TWO TRANSPORTS, TWO MECHANISMS. The runner path prefixes the stdin script: `psql` argv is
 *   the consumer's to join into a remote command, and a value with a space would split. The
 *   socket path pins the ONE connection an operation reserves, because the driver's startup
 *   message carries user, database and application_name only (`PgConnection.ts`, 4.0.0-rc.115)
 *   and a pool hands each statement a different, unpinned connection.
 */
import type { PgClient } from '@effect/sql-pg/PgClient';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';

export const PIN_SEARCH_PATH_SQL = 'SET search_path = pg_catalog, pg_temp';

/** The runner path's script prefix. */
export const PIN_SCRIPT_PREFIX = `${PIN_SEARCH_PATH_SQL};\n`;

/** A runner stdin without its pin — for tests that assert the statement that follows it. */
export const stripPin = (stdin: string): string =>
  stdin.startsWith(PIN_SCRIPT_PREFIX) ? stdin.slice(PIN_SCRIPT_PREFIX.length) : stdin;

/**
 * A `PgExecutor` over ONE reserved, pinned connection, for the life of the surrounding scope.
 * `unsafe` runs on it (the client routes any statement under `transactionService` to that
 * connection, so spans and error classification stay the driver's); `transaction` is a plain
 * `BEGIN` … `COMMIT` on it — `withTransaction` would open a SAVEPOINT, because the service is
 * already provided. A failure rolls back, and the pin is re-asserted by the next operation's own
 * reservation, never assumed to survive one.
 */
export const pinnedSocketExecutor = (
  pg: PgClient,
): Effect.Effect<PgExecutor, SqlError, Scope.Scope> =>
  Effect.gen(function* () {
    const connection = yield* pg.reserve;
    const run = <A extends object>(sql: string, params?: ReadonlyArray<unknown>) =>
      Effect.provideService(pg.unsafe<A>(sql, params), pg.transactionService, [connection, 0]);
    yield* run(PIN_SEARCH_PATH_SQL);
    return {
      unsafe: run,
      transaction: (statements) =>
        Effect.gen(function* () {
          yield* run('BEGIN');
          for (const sql of statements) yield* run(sql);
          yield* run('COMMIT');
        }).pipe(
          Effect.onError(() => run('ROLLBACK').pipe(Effect.ignore)),
          Effect.asVoid,
        ),
    };
  });
