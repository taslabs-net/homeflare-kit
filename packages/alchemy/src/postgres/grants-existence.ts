/**
 * Pre-statement existence guards for `Postgres.Grants`: every declared table and column
 * must exist in the schema before any GRANT/REVOKE runs. A missing object would fail
 * as a raw 42P01/42703 after earlier statements had already landed, leaving the state
 * row `creating` and the resume failing OwnedBySomeoneElse.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import type { DeclaredGrants } from './grants-declare.ts';
import { PostgresGrantsColumnMissing, PostgresGrantsTableMissing } from './grants-errors.ts';

/** One JSON string, never a JS array: the psql transport accepts only string parameters
 * (`psql-executor.ts`). `json_array_elements_text` expands that array to text
 * (`func.sgml@REL_18_6`). */
const TABLES_PRESENT_SQL = `SELECT
    c.relname AS table
  FROM pg_catalog.pg_class c
  WHERE c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1)
    AND c.relname::text IN (SELECT pg_catalog.json_array_elements_text($2::json))`;

const findMissingTable = (
  pg: PgExecutor,
  schema: string,
  tables: ReadonlyArray<string>,
): Effect.Effect<string | undefined, SqlError> =>
  tables.length === 0
    ? Effect.succeed(undefined)
    : Effect.map(
        pg.unsafe<{ readonly table: string }>(TABLES_PRESENT_SQL, [schema, JSON.stringify(tables)]),
        (rows) => {
          const present = new Set(rows.map((row) => row.table));
          return tables.find((table) => !present.has(table));
        },
      );

/** Pairs, not `relname || '.' || attname`. A table named `a.b` with column `c` and a
 * table named `a` with column `b.c` are the same concatenated string and one of them
 * would read as present. `->>` yields text (`func.sgml@REL_18_6`); the parameter is
 * one JSON string so the psql transport accepts it. */
const COLUMNS_PRESENT_SQL = `SELECT
    c.relname AS table,
    a.attname AS column
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  WHERE c.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1)
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND (c.relname, a.attname) IN (
      SELECT x->>0, x->>1 FROM pg_catalog.json_array_elements($2::json) x
    )`;

const findMissingColumn = (
  pg: PgExecutor,
  schema: string,
  columns: ReadonlyArray<{ readonly table: string; readonly column: string }>,
): Effect.Effect<{ readonly table: string; readonly column: string } | undefined, SqlError> =>
  columns.length === 0
    ? Effect.succeed(undefined)
    : Effect.map(
        pg.unsafe<{ readonly table: string; readonly column: string }>(COLUMNS_PRESENT_SQL, [
          schema,
          JSON.stringify(columns.map(({ table, column }) => [table, column])),
        ]),
        (rows) => {
          const present = new Set(rows.map((row) => `${row.table}\u0000${row.column}`));
          return columns.find(({ table, column }) => !present.has(`${table}\u0000${column}`));
        },
      );

/** Fail typed before any statement if a declared table or column does not exist. */
export const requireDeclaredObjectsExist = (
  pg: PgExecutor,
  declared: DeclaredGrants,
): Effect.Effect<void, PostgresGrantsTableMissing | PostgresGrantsColumnMissing | SqlError> =>
  Effect.gen(function* () {
    const missingTable = yield* findMissingTable(
      pg,
      declared.schema,
      declared.tables.map((table) => table.table),
    );
    if (missingTable !== undefined) {
      return yield* Effect.fail(
        new PostgresGrantsTableMissing({ schema: declared.schema, table: missingTable }),
      );
    }
    const missingColumn = yield* findMissingColumn(
      pg,
      declared.schema,
      declared.columns.map((column) => ({ table: column.table, column: column.column })),
    );
    if (missingColumn !== undefined) {
      return yield* Effect.fail(
        new PostgresGrantsColumnMissing({
          schema: declared.schema,
          table: missingColumn.table,
          column: missingColumn.column,
        }),
      );
    }
  });
