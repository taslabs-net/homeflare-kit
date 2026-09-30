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
import {
  type PostgresConnectionConfig,
  type PostgresRunnerConfig,
  postgresConnection,
  postgresRunnerConnection,
} from './connection.ts';
import { PostgresDatabaseProvider } from './database.ts';
import { PostgresSchemaProvider } from './schema.ts';

// ⚠️ `Layer.provideMerge`, NEVER plain `Layer.provide`: the handlers' `withPg` reads
//   `PostgresConnection` when the ENGINE later calls `read`/`reconcile`, and plain `provide`
//   seals it away ("Service not found: Postgres.Connection" — measured for `caddyProviders`,
//   see `caddy/providers.ts`).
export const postgresProviders = (config: PostgresConnectionConfig) =>
  PostgresSchemaProvider().pipe(
    Layer.provideMerge(
      PostgresDatabaseProvider().pipe(Layer.provideMerge(postgresConnection(config))),
    ),
  );

/** The same provider over a command runner (`psql-executor.ts`) — for a loopback-only cluster. */
export const postgresRunnerProviders = (config: PostgresRunnerConfig) =>
  PostgresSchemaProvider().pipe(
    Layer.provideMerge(
      PostgresDatabaseProvider().pipe(Layer.provideMerge(postgresRunnerConnection(config))),
    ),
  );
