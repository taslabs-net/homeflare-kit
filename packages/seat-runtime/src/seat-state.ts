/**
 * `SeatState`: a seat's Postgres and Valkey as Effect services, one layer each, in the trace of
 * the run that uses them.
 *
 * ⛔ THE LIBRARY HOLDS NO HOST. Every URL comes from the consumer (a value, or an environment
 *   variable it names), as `Redacted`; there is no default address here to point a seat at the
 *   wrong store, and nothing reads a credential from disk.
 * ★ THE SERVICES ARE EFFECT'S, NOT OURS: `SqlClient` (`effect/unstable/sql/SqlClient`) for
 *   Postgres and `Redis` (`effect/unstable/persistence/Redis`) for Valkey, so a consumer writes
 *   ordinary Effect SQL and Redis code and this package adds only how they are built.
 */
import * as Layer from 'effect/Layer';
import type * as Redis from 'effect/unstable/persistence/Redis';
import type * as SqlClient from 'effect/unstable/sql/SqlClient';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { Config } from 'effect';
import type { PgClient } from '@effect/sql-pg';
import {
  type PostgresFromEnvOptions,
  type PostgresOptions,
  postgres,
  postgresFromEnv,
} from './state-postgres.ts';
import {
  type ValkeyFromEnvOptions,
  type ValkeyOptions,
  valkey,
  valkeyFromEnv,
} from './state-valkey.ts';

export * from './state-postgres.ts';
export * from './state-valkey.ts';
// ★ RE-EXPORTED so a consumer under pnpm's strict resolution can name `PgClient` (for `.json`,
//   `.listen`, `.notify`) without also depending on `@effect/sql-pg` itself.
export { PgClient } from '@effect/sql-pg';

/** Both stores, each built from an explicit URL. */
export const layer = (options: {
  readonly postgres: PostgresOptions;
  readonly valkey: ValkeyOptions;
}): Layer.Layer<
  PgClient.PgClient | SqlClient.SqlClient | Redis.Redis,
  SqlError | Redis.RedisError
> => Layer.mergeAll(postgres(options.postgres), valkey(options.valkey));

/** Both stores, each URL read from its environment variable (`SEAT_POSTGRES_URL`, `SEAT_VALKEY_URL`). */
export const layerFromEnv = (options?: {
  readonly postgres?: PostgresFromEnvOptions | undefined;
  readonly valkey?: ValkeyFromEnvOptions | undefined;
}): Layer.Layer<
  PgClient.PgClient | SqlClient.SqlClient | Redis.Redis,
  SqlError | Redis.RedisError | Config.ConfigError
> => Layer.mergeAll(postgresFromEnv(options?.postgres), valkeyFromEnv(options?.valkey));
