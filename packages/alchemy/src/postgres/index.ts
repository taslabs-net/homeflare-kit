/**
 * PostgreSQL providers for Alchemy — `Postgres.Database`, create-and-assert over a self-hosted
 * cluster, and `Postgres.Grants`, a declarative grant set diffed against the catalogs — walked
 * against PostgreSQL 18.6. See `docs/postgres.md`.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, deliberately smaller than the directory: `fake-sql.ts` and
 *   `fake-grants-sql.ts` are test doubles, not something a consuming stack should import.
 */
export type { PostgresConnectionConfig, PostgresRunnerConfig } from './connection.ts';
export {
  PostgresConnection,
  postgresConnection,
  postgresRunnerConnection,
  withPg,
} from './connection.ts';
export type { PsqlResult, PsqlRunner } from './psql-executor.ts';
export { inlineParams, makePsqlExecutor } from './psql-executor.ts';
export type { PostgresDatabaseAttributes, PostgresDatabaseProps } from './database-attrs.ts';
export { POSTGRES_NAME_MAX_BYTES, nameByteRefusal, utf8ByteLength } from './database-attrs.ts';
export {
  buildCreateDatabaseSql,
  firstDrift,
  isDuplicateDatabaseRace,
  quoteIdent,
  quoteStringLiteral,
  roleExists,
  selectDatabase,
} from './database-sql.ts';
export { PostgresDatabase, PostgresDatabaseProvider, isPostgresDatabase } from './database.ts';
export {
  PostgresDatabaseDrift,
  PostgresDatabaseDropRefused,
  PostgresDatabaseNameRefused,
  PostgresDatabaseOwnerMissing,
  PostgresDatabaseRenameRefused,
  type PostgresDatabaseError,
} from './errors.ts';
export type {
  PostgresGrantsAttributes,
  PostgresGrantsAttributesColumn,
  PostgresGrantsAttributesDefault,
  PostgresGrantsAttributesTable,
  PostgresGrantsColumn,
  PostgresGrantsDefault,
  PostgresGrantsProps,
  PostgresGrantsTable,
} from './grants-attrs.ts';
export {
  COLUMN_PRIVILEGES,
  SCHEMA_PRIVILEGES,
  TABLE_PRIVILEGES,
  grantsNameByteRefusal,
  letterForPrivilege,
} from './grants-attrs.ts';
export {
  grantColumnSql,
  grantDefaultSql,
  grantSchemaSql,
  grantTableSql,
  revokeColumnSql,
  revokeDefaultSql,
  revokePublicSchemaSql,
  revokePublicTablesSql,
  revokeSchemaSql,
  revokeTableSql,
} from './grants-sql.ts';
export { PostgresGrants, PostgresGrantsProvider, isPostgresGrants } from './grants.ts';
export {
  PostgresGrantsDatabaseMismatch,
  PostgresGrantsDuplicateObject,
  PostgresGrantsNameRefused,
  PostgresGrantsPrivilegeRefused,
  PostgresGrantsRepairRefused,
  PostgresGrantsRetargetRefused,
  PostgresGrantsRoleMissing,
  PostgresGrantsSchemaMissing,
  type PostgresGrantsError,
} from './grants-errors.ts';
export { postgresProviders, postgresRunnerProviders } from './providers.ts';
