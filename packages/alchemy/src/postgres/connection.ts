/**
 * Where a database's cluster comes from, and how each lifecycle operation gets a client.
 *
 * ⛔ NO ESTATE VALUE LIVES HERE. The kit is PUBLIC; the mini's socket path, its user and its
 *   database names are the CONSUMER's props, passed to `postgresConnection(...)` in a house
 *   stack — never a default, never a fallback (`docs/postgres.md#path`).
 * ★ A LAZY `Context.Service` WHOSE VALUE IS AN `Effect` (S24), THE SAME SHAPE THE HOUSE USES FOR
 *   CREDENTIALS: `yield* yield* PostgresConnection` resolves the config INSIDE each operation,
 *   never at layer build. Nothing here holds a secret today (`PostgresConnectionConfig` has no
 *   `password` — S25, and CREATE DATABASE has none to assert either), but the shape is the one a
 *   later TLS path (`Config.redacted` from the environment) drops into without a rewrite.
 * ★ THE POOL IS BUILT IN A SCOPE AND CLOSED PER OPERATION. `Effect.provide(op, PgClient.layer(config))`
 *   already opens a scope for the layer's build and closes it when `op` finishes — one pool per
 *   `withPg` call, never held across a whole `reconcile`.
 */
import * as PgClient from '@effect/sql-pg/PgClient';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { SqlError } from 'effect/unstable/sql/SqlError';

/** What a stack passes to reach one cluster. `host` may be a socket directory (one beginning
 * with `/` expands to `${host}/.s.PGSQL.${port}` — measured in
 * `node_modules/@effect/sql-pg/src/PgConnection.ts`, the "Details" doc on `Config`) or a TCP
 * host name; `port` defaults to `@effect/sql-pg`'s own default (5432) when omitted. */
export interface PostgresConnectionConfig {
  readonly host: string;
  readonly port?: number;
  readonly database: string;
  readonly username: string;
  readonly ssl?: boolean;
}

/** The lazy connection service. Its value is an `Effect` of the config, per S24 — see the file
 * header for why. */
export class PostgresConnection extends Context.Service<
  PostgresConnection,
  Effect.Effect<PostgresConnectionConfig>
>()('Postgres.Connection') {}

/** A stack's one-line way to provide a cluster: `Layer.provide(postgresConnection({ … }))` on
 * `PostgresDatabaseProvider()`, or merged into the stack's own layer tree. */
export const postgresConnection = (
  config: PostgresConnectionConfig,
): Layer.Layer<PostgresConnection> => Layer.succeed(PostgresConnection, Effect.succeed(config));

/**
 * Run one operation against a freshly built, freshly closed connection pool.
 *
 * Every `read`, `reconcile` step and `delete` in this family calls this once for the whole
 * operation — never once per statement — so a reconcile that runs a `SELECT`, then a `CREATE`,
 * then a re-read shares one pool and closes it once, while a plan-only `read` still opens and
 * closes its own.
 */
export const withPg = <A, E>(
  build: (pg: PgClient.PgClient) => Effect.Effect<A, E>,
): Effect.Effect<A, E | SqlError, PostgresConnection> =>
  Effect.gen(function* () {
    const resolveConfig = yield* PostgresConnection;
    const config = yield* resolveConfig;
    return yield* Effect.provide(Effect.flatMap(PgClient.PgClient, build), PgClient.layer(config));
  });
