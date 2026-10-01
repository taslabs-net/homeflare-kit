/**
 * PostgreSQL providers for Alchemy — `Postgres.Database` (create-and-assert over one
 * self-hosted cluster), `Postgres.Schema` (create-and-assert over one schema inside one), and
 * `Postgres.Role` (create / adopt / alter / drop of a LOGIN or NOLOGIN role whose password is a
 * reference), walked against PostgreSQL 18.6. See `docs/postgres.md`, `docs/postgres-schema.md`
 * and `docs/postgres-role.md`.
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
  databaseExists,
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
  currentUser,
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
  PostgresSchemaDeleteForeignRefused,
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
export type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
export { sameValidUntil, validUntilRefusal } from './role-attrs.ts';
export {
  buildAlterRoleSql,
  buildCreateRoleSql,
  buildDropRoleSql,
  buildSetPasswordSql,
  scalarDrift,
  selectRole,
} from './role-sql.ts';
export {
  buildGrantMembershipSql,
  buildRepairMembershipSql,
  buildRevokeGrantorMembershipSql,
  membershipDrift,
  selectRoleMemberships,
  syncMemberships,
  unsafeMemberships,
} from './role-membership-sql.ts';
export type { MembershipRow } from './role-membership-sql.ts';
export { PostgresRole, isPostgresRole } from './role.ts';
export { PostgresRoleProvider } from './role-provider.ts';
export { resolvePassword } from './role-secrets.ts';
export type { ResolvedPassword } from './role-secrets.ts';
export type { FromEnv } from '../secrets/write-only.ts';
export {
  PostgresRoleCreateVanished,
  PostgresRoleIdentityRefused,
  PostgresRoleMembershipUnrepaired,
  PostgresRoleNameRefused,
  PostgresRoleParentMissing,
  PostgresRolePasswordEnvUnsetError,
  PostgresRolePrivilegedRefused,
  PostgresRoleRenameRefused,
  PostgresRoleValidUntilRefused,
  type PostgresRoleError,
} from './role-errors.ts';
export {
  postgresProviders,
  postgresRoleProviders,
  postgresRoleRunnerProviders,
  postgresRunnerProviders,
} from './providers.ts';
