/**
 * The statements `Postgres.Schema` issues and the quoting each needs.
 *
 * ⛔ `CREATE SCHEMA` TAKES NO BIND PARAMETERS. Measured at `gram.y@REL_18_6`:
 *   `CreateSchemaStmt: CREATE SCHEMA [IF NOT EXISTS] opt_schema_name AUTHORIZATION
 *   RoleSpec | create_schema_name opt_schema_element_list`. Neither the name nor the
 *   authorization role reaches `PARAM` (`$n`), so every free-form value is escaped by hand
 *   (`quoteIdent`) and the assembled text runs through `.unsafe()`.
 * ★ The schema name is a single `ColId` token, so `quoteIdent` (single-token quoting) is
 *   correct — same rule as `Postgres.Database`'s name.
 */
import type { SqlError } from 'effect/unstable/sql/SqlError';
import * as Effect from 'effect/Effect';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { quoteIdent, quoteStringLiteral } from './database-sql.ts';
import type { PgExecutor } from './database-sql.ts';

/** `CREATE SCHEMA IF NOT EXISTS "name" [AUTHORIZATION "owner"]` — the only create this family issues. */
export const buildCreateSchemaSql = (props: PostgresSchemaProps): string =>
  `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(props.name)}${
    props.owner === undefined ? '' : ` AUTHORIZATION ${quoteIdent(props.owner)}`
  }`;

/** `COMMENT ON SCHEMA "name" IS '…'` — issued only when a comment is declared. */
export const buildCommentSchemaSql = (name: string, comment: string): string =>
  `COMMENT ON SCHEMA ${quoteIdent(name)} IS ${quoteStringLiteral(comment)}`;

/** `DROP SCHEMA IF EXISTS "name" [CASCADE]` — idempotent; `CASCADE` only when declared. */
export const buildDropSchemaSql = (name: string, cascade: boolean): string =>
  `DROP SCHEMA IF EXISTS ${quoteIdent(name)}${cascade ? ' CASCADE' : ''}`;

const SELECT_SCHEMA_SQL = `SELECT
    n.oid AS oid,
    n.nspname AS name,
    pg_get_userbyid(n.nspowner) AS owner,
    obj_description(n.oid, 'pg_namespace') AS comment,
    current_database() AS database
  FROM pg_namespace n
  WHERE n.nspname = $1`;

/** The read: one bound `SELECT` on `pg_namespace`. `undefined` when absent. The row carries
 * `current_database()` as `database`, so every caller can prove where the statement ran. */
export const selectSchema = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<PostgresSchemaAttributes | undefined, SqlError> =>
  Effect.map(pg.unsafe<PostgresSchemaAttributes>(SELECT_SCHEMA_SQL, [name]), (rows) => rows[0]);

const CURRENT_DATABASE_SQL = 'SELECT current_database() AS database';

/** Which database this executor actually reaches — checked before any `CREATE` or `DROP SCHEMA`,
 * so a schema declared for `agents` can never quietly land in the maintenance database the
 * family connection points at. */
export const currentDatabase = (pg: PgExecutor): Effect.Effect<string, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly database: string }>(CURRENT_DATABASE_SQL),
    // current_database() always answers one row; an empty fallback can only compare unequal,
    // failing closed into PostgresSchemaWrongDatabase.
    (rows) => rows[0]?.database ?? '',
  );

/**
 * "Empty" means no object of ANY kind the schema owns. Measured object kinds live in four
 * catalogs: relations (tables, views, indexes, sequences — `pg_class`), functions and
 * aggregates (`pg_proc`), types, domains and enums (`pg_type`), operators (`pg_operator`). A
 * kind without a dedicated catalog (an extension's `extnamespace`, a collation) can still pass
 * this check — and then the plain `DROP SCHEMA` answers `2BP01`, which `dropWithClient`
 * classifies as the same typed refusal.
 *
 * ⚠️ THE FAKE (`fake-sql.ts`) ROUTES THIS STATEMENT BY `AS empty` + `pg_class` — keep both
 *   markers in any rewrite, and keep this check matched BEFORE the plain `pg_namespace` branch
 *   (this SQL contains `FROM pg_namespace` too, inside its `WITH`).
 */
const SCHEMA_EMPTY_SQL = `WITH ns AS (SELECT oid FROM pg_namespace WHERE nspname = $1)
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.relnamespace = (SELECT oid FROM ns)
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.pronamespace = (SELECT oid FROM ns)
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typnamespace = (SELECT oid FROM ns)
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_operator o WHERE o.oprnamespace = (SELECT oid FROM ns)
  ) AS empty`;

/** `true` when the schema holds none of the four object catalogs above (used before a
 * non-cascade `DROP SCHEMA`). */
export const schemaIsEmpty = (pg: PgExecutor, name: string): Effect.Effect<boolean, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly empty: boolean }>(SCHEMA_EMPTY_SQL, [name]),
    (rows) => rows[0]?.empty ?? true,
  );

/** SQLSTATE `2BP01` (`dependent_objects_still_exist`): the non-cascade `DROP SCHEMA` refused
 * because an object kind outside the emptiness check's four catalogs still exists. Measured at
 * `internal/sqlError.ts@effect/sql-pg`: every SQLSTATE starting `42` classifies as
 * `SqlSyntaxError` with the raw code on `reason.cause.code` — the same shape
 * `isDuplicateDatabaseRace` (`database-sql.ts`) reads, and the runner transport's `failure()`
 * (`psql-executor.ts`) produces. */
export const isDependentObjectsError = (error: SqlError): boolean => {
  if (error.reason._tag !== 'SqlSyntaxError') return false;
  const cause = error.reason.cause;
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '2BP01'
  );
};
