/**
 * `Postgres.Database`'s provider, pre-wired to one cluster:
 *
 *     const providers = postgresProviders({ host: '/opt/homeflare/postgres/sockets', database: 'postgres', username: 'tim' });
 *
 * ★ THE CLUSTER IS A PARAMETER, NOT A DEFAULT (S15, and `docs/postgres.md#path`). This kit is
 *   PUBLIC; the mini's socket directory, its user and its port are the CONSUMING stack's values,
 *   never baked in here. A stack with more than one cluster calls this more than once and merges
 *   the results under whatever logical grouping it wants.
 */
import * as Layer from 'effect/Layer';
import { type PostgresConnectionConfig, postgresConnection } from './connection.ts';
import { PostgresDatabaseProvider } from './database.ts';

export const postgresProviders = (config: PostgresConnectionConfig) =>
  PostgresDatabaseProvider().pipe(Layer.provide(postgresConnection(config)));
