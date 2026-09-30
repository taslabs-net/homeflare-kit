/**
 * PostgreSQL providers for Alchemy — `Postgres.Database` (create-and-assert over one
 * self-hosted cluster) and `Postgres.Schema` (create-and-assert over one schema inside one),
 * both walked against PostgreSQL 18.6. See `docs/postgres.md` and `docs/postgres-schema.md`.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, deliberately smaller than the directory: `fake-sql.ts` is a
 *   test double, not something a consuming stack should import.
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
export type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
export { normalizedComment, schemaNameByteRefusal } from './schema-attrs.ts';
export {
  buildCommentSchemaSql,
  buildCreateSchemaSql,
  buildDropSchemaSql,
  currentDatabase,
  isDependentObjectsError,
  schemaIsEmpty,
  selectSchema,
} from './schema-sql.ts';
export {
  PostgresSchema,
  PostgresSchemaProvider,
  diffPostgresSchema,
  isPostgresSchema,
} from './schema.ts';
export {
  PostgresSchemaCreateVanished,
  PostgresSchemaDatabaseRefused,
  PostgresSchemaDrift,
  PostgresSchemaDropNotEmptyError,
  PostgresSchemaNameRefused,
  PostgresSchemaOwnerMissing,
  PostgresSchemaRenameRefused,
  PostgresSchemaWrongDatabase,
  type PostgresSchemaError,
} from './schema-errors.ts';
export {
  PostgresDatabaseDrift,
  PostgresDatabaseDropRefused,
  PostgresDatabaseNameRefused,
  PostgresDatabaseOwnerMissing,
  PostgresDatabaseRenameRefused,
  type PostgresDatabaseError,
} from './errors.ts';
export { postgresProviders, postgresRunnerProviders } from './providers.ts';
