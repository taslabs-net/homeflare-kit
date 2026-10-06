/**
 * The ownership reads of `Postgres.Grants`: `pg_namespace.nspowner` and `pg_class.relowner`
 * for the declared role, in one schema. The repair and the delete need these to LEAVE
 * objects the grantee owns alone (H2, `grants-plan.ts`): an owner holds every privilege
 * implicitly and a `REVOKE` cannot take that away, so neither writes nor clears ACL rows
 * on an owned object — measured on PG 18.6, where the docs' own seat example had its
 * owner rights churned by the table-level `REVOKE ALL`.
 *
 * ★ A fresh schema or table the role owns carries NO ACL rows at all, so the ownership
 *   facts cannot ride the `aclexplode` reads (`grants-read.ts`) — they are separate
 *   queries, still inside the read's one bounded burst.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';

/** `pg_namespace.nspowner = <role>` for one schema. No rows when the schema is absent —
 * the caller then reads the fact as `false`. */
const SCHEMA_OWNER_SQL = `SELECT
    n.nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2) AS role_owns
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname = $1`;

export const readSchemaOwnership = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<boolean, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly role_owns: boolean }>(SCHEMA_OWNER_SQL, [schema, role]),
    (rows) => rows[0]?.role_owns === true,
  );

/** Every relation in the schema the declared role OWNS, all relkinds (the table class is
 * not relkind-filtered, and neither is this). */
const OWNED_TABLES_SQL = `SELECT c.relname AS table
  FROM pg_catalog.pg_class c
  WHERE c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1)
    AND c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $2)
  ORDER BY c.relname`;

export const readOwnedTables = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<ReadonlyArray<string>, SqlError> =>
  Effect.map(pg.unsafe<{ readonly table: string }>(OWNED_TABLES_SQL, [schema, role]), (rows) =>
    rows.map((row) => row.table).sort((a, b) => a.localeCompare(b)),
  );
