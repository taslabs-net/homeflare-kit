/**
 * The `Postgres.*` providers, pre-wired to one cluster:
 *
 *     const providers = postgresProviders({ host: '/var/run/postgresql', database: 'postgres', username: 'tim' });
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
import { PostgresGrantsProvider } from './grants.ts';

// ⚠️ `Layer.provideMerge`, NEVER plain `Layer.provide`: the handlers' `withPg` reads
//   `PostgresConnection` when the ENGINE later calls `read`/`reconcile`, and plain `provide`
//   seals it away ("Service not found: Postgres.Connection" — measured for `caddyProviders`,
//   see `caddy/providers.ts`). Each resource provider merges its own connection in; the two
//   results are merged per resource (`Layer.mergeAll`, the same shape `unifi/providers.ts`).
export const postgresProviders = (config: PostgresConnectionConfig) =>
  Layer.mergeAll(
    PostgresDatabaseProvider().pipe(Layer.provideMerge(postgresConnection(config))),
    PostgresGrantsProvider().pipe(Layer.provideMerge(postgresConnection(config))),
  );

/** The same providers over a command runner (`psql-executor.ts`) — for a loopback-only cluster. */
export const postgresRunnerProviders = (config: PostgresRunnerConfig) =>
  Layer.mergeAll(
    PostgresDatabaseProvider().pipe(Layer.provideMerge(postgresRunnerConnection(config))),
    PostgresGrantsProvider().pipe(Layer.provideMerge(postgresRunnerConnection(config))),
  );
