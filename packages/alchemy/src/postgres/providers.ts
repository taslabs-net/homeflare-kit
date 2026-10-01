/**
 * `Postgres.*` providers, pre-wired for one cluster:
 *
 *     const providers = postgresProviders({ host: '/var/run/postgresql', database: 'postgres', username: 'tim' });
 *
 * ★ THE CLUSTER IS THE PARAMETER, NOT A DEFAULT (S15, `docs/postgres.md#path`). This kit is
 *   PUBLIC; mini's socket directory, user and port are the CONSUMING stack's values,
 *   never baked in here. A stack with more than one cluster calls this once per cluster and merges
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
import { PostgresRoleProvider } from './role-provider.ts';
import { PostgresSchemaProvider } from './schema.ts';

// ⚠️ `Layer.provideMerge`, NEVER plain `Layer.provide`: the handlers' `withPg` reads
//   `PostgresConnection` when the ENGINE later calls `read`/`reconcile`, and plain `provide`
//   seals it away ("Service not found: Postgres.Connection" — measured for `caddyProviders`,
//   see `caddy/providers.ts`). Each resource provider merges its own connection in; the three
//   results are merged per resource (`Layer.mergeAll`, the same shape `unifi/providers.ts`).
export const postgresProviders = (config: PostgresConnectionConfig) =>
  Layer.mergeAll(
    PostgresDatabaseProvider().pipe(Layer.provideMerge(postgresConnection(config))),
    PostgresSchemaProvider().pipe(Layer.provideMerge(postgresConnection(config))),
    PostgresGrantsProvider().pipe(Layer.provideMerge(postgresConnection(config))),
  );

/** The same providers over a command runner (`psql-executor.ts`) — for loopback-only clusters. */
export const postgresRunnerProviders = (config: PostgresRunnerConfig) =>
  Layer.mergeAll(
    PostgresDatabaseProvider().pipe(Layer.provideMerge(postgresRunnerConnection(config))),
    PostgresSchemaProvider().pipe(Layer.provideMerge(postgresRunnerConnection(config))),
    PostgresGrantsProvider().pipe(Layer.provideMerge(postgresRunnerConnection(config))),
  );

/**
 * `Postgres.Role`'s provider, over the same socket transport and the same cluster parameter.
 *
 *     const providers = postgresRoleProviders({ host: '/opt/homeflare/postgres/sockets', database: 'postgres', username: 'tim' });
 */
export const postgresRoleProviders = (config: PostgresConnectionConfig) =>
  PostgresRoleProvider().pipe(Layer.provideMerge(postgresConnection(config)));

/** `Postgres.Role` over a command runner (`psql-executor.ts`) — for loopback-only clusters. */
export const postgresRoleRunnerProviders = (config: PostgresRunnerConfig) =>
  PostgresRoleProvider().pipe(Layer.provideMerge(postgresRunnerConnection(config)));
