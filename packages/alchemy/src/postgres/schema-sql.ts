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
    obj_description(n.oid, 'pg_namespace') AS comment
  FROM pg_namespace n
  WHERE n.nspname = $1`;

/** The read: one bound `SELECT` on `pg_namespace`. `undefined` when absent. */
export const selectSchema = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<PostgresSchemaAttributes | undefined, SqlError> =>
  Effect.map(pg.unsafe<PostgresSchemaAttributes>(SELECT_SCHEMA_SQL, [name]), (rows) => rows[0]);

const SCHEMA_EMPTY_SQL = `SELECT NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
  ) AS empty`;

/** `true` when the schema has no relations (used before `DROP SCHEMA` without `CASCADE`). */
export const schemaIsEmpty = (pg: PgExecutor, name: string): Effect.Effect<boolean, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly empty: boolean }>(SCHEMA_EMPTY_SQL, [name]),
    (rows) => rows[0]?.empty ?? true,
  );
