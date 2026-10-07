/**
 * Postgres as Effect's own `SqlClient`, through `@effect/sql-pg`.
 *
 * ★ THE SDK'S OWN LAYER, NOT A WRAPPER OF IT. `PgClient` opens the pool and creates one
 *   `sql.execute` client span per statement carrying `db.system.name: postgresql`,
 *   `db.namespace`, `server.address`, `server.port` and `db.query.text` (measured 2026-09-29
 *   against CT100's Postgres), so state lands in the seat's trace with no `withSpan` of ours.
 *   ⚠️ `db.query.text` is the statement with its `$1` placeholders: parameter VALUES are not in
 *   the span (tests/state-postgres.test.ts asserts a canary value never leaves).
 * ⛔ WHAT THIS ADDS is the two things the driver leaves to the caller, both measured
 *   2026-09-29 and both in state-dsn.ts: a DSN that will not parse never reaches the driver (its
 *   error carries the string, password included), and the URL's host, port, database and user are
 *   passed as discrete fields so the spans name the database that was actually reached (from `url`
 *   alone they say `localhost:5432`, database `postgres`).
 * ⛔ BUILDING THE LAYER RUNS `select 1`. The pool is lazy (a bad host or password otherwise fails
 *   at the first query), so a seat that starts against a dead or refusing Postgres is told at
 *   startup, as `SqlError`, within `connectTimeout`.
 * ⚠️ PORTABLE. `@effect/sql-pg` rc.115 speaks the wire protocol itself over `node:net`, with no
 *   driver package, so this half runs under Bun and Node alike (the Valkey half needs Bun).
 */
import { PgClient } from '@effect/sql-pg';
import * as Config from 'effect/Config';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import type * as SqlClient from 'effect/sql/SqlClient';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import { postgresFields } from './state-dsn.ts';

export type PostgresOptions = {
  /**
   * `postgres://<user>:<password>@<host>:<port>/<database>` (or `postgresql://`), the user and
   * password percent-encoded. Held `Redacted`; never in a span, log or error. Required: this
   * package holds no host. `sslmode=require|verify-ca|verify-full|disable` is read; the driver
   * refuses `prefer` and `allow`.
   */
  readonly url: string | Redacted.Redacted<string>;
  /** Pool ceiling; the driver's default when absent. */
  readonly maxConnections?: number | undefined;
  /** How long to wait for a connection, and for the startup `select 1`. Driver default 5 s. */
  readonly connectTimeout?: Duration.Input | undefined;
  /** Shown in `pg_stat_activity`; the driver's default when absent. */
  readonly applicationName?: string | undefined;
};

/** The environment variable `postgresFromEnv` reads unless told another. Not a host. */
export const POSTGRES_URL_VARIABLE = 'SEAT_POSTGRES_URL';

const DEFAULT_CONNECT_TIMEOUT: Duration.Duration = Duration.seconds(5);

/** A failure that names the reason and never the DSN. */
const refused = (message: string): SqlError =>
  new SqlError({
    reason: new ConnectionError({
      cause: new Error(message),
      message: `SeatState postgres: ${message}`,
      operation: 'connect',
    }),
  });

const acquire = Effect.fnUntraced(function* (options: PostgresOptions) {
  const dsn = Redacted.value(
    typeof options.url === 'string' ? Redacted.make(options.url) : options.url,
  );
  const fields = postgresFields(dsn);
  if (fields === undefined) return yield* refused('the URL is not a postgres:// URL');
  const connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
  const client = yield* PgClient.make({
    url: Redacted.make(dsn),
    ...fields,
    maxConnections: options.maxConnections,
    connectTimeout,
    applicationName: options.applicationName,
  });
  yield* client`select 1`.pipe(
    Effect.timeoutOrElse({
      duration: connectTimeout,
      orElse: () =>
        Effect.fail(
          refused(`did not answer within ${String(Duration.toMillis(connectTimeout))} ms`),
        ),
    }),
  );
  return client;
});

/**
 * `SqlClient` and `PgClient` against one Postgres. The pool closes with the layer's scope.
 */
export const postgres = (
  options: PostgresOptions,
): Layer.Layer<PgClient.PgClient | SqlClient.SqlClient, SqlError> =>
  PgClient.layerFrom(Effect.suspend(() => acquire(options)));

export type PostgresFromEnvOptions = Omit<PostgresOptions, 'url'> & {
  /** The variable holding the URL. Default `SEAT_POSTGRES_URL`. */
  readonly variable?: string | undefined;
};

/**
 * `postgres`, its URL read from an environment variable as a `Redacted` secret. A missing
 * variable fails as `ConfigError`, naming the variable and nothing else.
 */
export const postgresFromEnv = (
  options?: PostgresFromEnvOptions,
): Layer.Layer<PgClient.PgClient | SqlClient.SqlClient, SqlError | Config.ConfigError> => {
  const { variable, ...rest } = options ?? {};
  return Layer.unwrap(
    Config.Redacted(variable ?? POSTGRES_URL_VARIABLE).pipe(
      Effect.map((url) => postgres({ ...rest, url })),
    ),
  );
};
