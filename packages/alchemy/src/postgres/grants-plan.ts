/**
 * The diff engine's live half: the repair plan as a statement list, and the convergence
 * proof. Pure — no client, no `Effect` — so `reconcile`, the engine's `diff` and the tests
 * share one implementation (the family's S10 rule holds at the callers: `reconcile` re-reads
 * live after the statements run, and re-plans: an EMPTY plan is the no-op proof).
 *
 * ★ REPAIR SHAPE PER CLASS: on drift, `REVOKE ALL` (clears extras and grant options) then
 *   `GRANT` the declared words (only when any are declared), split by the grant-option flag.
 *   A class that declares nothing and holds nothing live is a no-op; a class that declares
 *   nothing but holds live grants gets only the revoke — that is how removing a grant from a
 *   declaration repairs it, and how `delete` (a cleared declaration, `grants-declare.ts`)
 *   revokes exactly what the old declaration named and nothing else.
 */
import type { PostgresGrantsAttributes } from './grants-attrs.ts';
import type { DeclaredGrants, DeclaredNames } from './grants-declare.ts';
import { splitGrantWords } from './grants-declare.ts';
import type { LiveGrants } from './grants-read.ts';
import {
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

/** Both sides are sorted by construction (declared by `cleanWords`, live by the reads), so
 * set equality is positional — grant-option marks included: `select` and `select*` are
 * DIFFERENT states and the repair must converge on the declared one. */
const wordsDiffer = (declared: ReadonlyArray<string>, live: ReadonlyArray<string>): boolean =>
  declared.length !== live.length || declared.some((word, index) => word !== live[index]);

const grantStatements = (
  words: ReadonlyArray<string>,
  grant: (words: ReadonlyArray<string>) => string,
): ReadonlyArray<string> => {
  const { plain, grantable } = splitGrantWords(words);
  return [
    ...(plain.length > 0 ? [grant(plain)] : []),
    ...(grantable.length > 0 ? [grant(grantable)] : []),
  ];
};

const liveTableWords = (live: LiveGrants, table: string): ReadonlyArray<string> =>
  live.tables.find((entry) => entry.table === table)?.role ?? [];

const liveColumnWords = (live: LiveGrants, table: string, column: string): ReadonlyArray<string> =>
  live.columns.find((entry) => entry.table === table && entry.column === column)?.role ?? [];

const liveDefaultWords = (live: LiveGrants, forRole: string): ReadonlyArray<string> =>
  live.defaults.find((entry) => entry.forRole === forRole)?.role ?? [];

/** Every statement the repair runs, in order. Classes whose live set already equals the
 * declared one contribute NOTHING — an already-correct declaration emits zero statements,
 * which is the re-run-is-a-no-op rule; the same function re-planned against the post-repair
 * read-back is the convergence proof (`PostgresGrantsRepairRefused` when it is not empty). */
export const planRepair = (declared: DeclaredGrants, live: LiveGrants): ReadonlyArray<string> => {
  const statements: string[] = [];
  if (wordsDiffer(declared.schemaPrivileges, live.schema.role)) {
    statements.push(revokeSchemaSql(declared.schema, declared.role));
    statements.push(
      ...grantStatements(declared.schemaPrivileges, (words) =>
        grantSchemaSql(declared.schema, declared.role, words),
      ),
    );
  }
  for (const table of declared.tables) {
    if (wordsDiffer(table.privileges, liveTableWords(live, table.table))) {
      statements.push(revokeTableSql(declared.schema, table.table, declared.role));
      statements.push(
        ...grantStatements(table.privileges, (words) =>
          grantTableSql(declared.schema, table.table, declared.role, words),
        ),
      );
    }
  }
  for (const column of declared.columns) {
    if (wordsDiffer(column.privileges, liveColumnWords(live, column.table, column.column))) {
      statements.push(revokeColumnSql(declared.schema, column.table, column.column, declared.role));
      statements.push(
        ...grantStatements(column.privileges, (words) =>
          grantColumnSql(declared.schema, column.table, column.column, declared.role, words),
        ),
      );
    }
  }
  for (const entry of declared.defaults) {
    if (wordsDiffer(entry.privileges, liveDefaultWords(live, entry.forRole))) {
      statements.push(revokeDefaultSql(declared.schema, entry.forRole, declared.role));
      statements.push(
        ...grantStatements(entry.privileges, (words) =>
          grantDefaultSql(declared.schema, entry.forRole, declared.role, words),
        ),
      );
    }
  }
  if (declared.publicSchemaRevoked && live.schema.public.length > 0) {
    statements.push(revokePublicSchemaSql(declared.schema));
  }
  if (
    declared.publicTablesRevoked &&
    (live.tables.some((table) => table.public.length > 0) ||
      live.columns.some((column) => column.public.length > 0))
  ) {
    statements.push(revokePublicTablesSql(declared.schema));
  }
  return statements;
};

/** The read-back projection: live catalog words, restricted to the names this declaration
 * (or, for `read`, the last one) claims — plus the one-directional PUBLIC fact. */
export const attributesOf = (live: LiveGrants, names: DeclaredNames): PostgresGrantsAttributes => ({
  role: names.role,
  database: names.database,
  schema: names.schema,
  schemaPrivileges: live.schema.role,
  tables: names.tables.map((table) => ({
    table,
    privileges: liveTableWords(live, table),
  })),
  columns: names.columns.map(({ table, column }) => ({
    table,
    column,
    privileges: liveColumnWords(live, table, column),
  })),
  defaults: names.defaults.map((forRole) => ({
    forRole,
    privileges: liveDefaultWords(live, forRole),
  })),
  publicSchemaRevoked: live.schema.public.length === 0,
  publicTablesRevoked:
    live.tables.every((table) => table.public.length === 0) &&
    live.columns.every((column) => column.public.length === 0),
});

/** The engine's plan-time comparison: the new declaration against the recorded (or freshly
 * read) attributes. PUBLIC is one-directional — a declaration that does not revoke
 * PUBLIC leaves whatever it holds alone, so live PUBLIC privileges with
 * `revokeFromPublic: false` are never drift. Everything else is full equality, grant-option
 * marks included; a changed NAME SET (a table added to or removed from the declaration)
 * answers `true` so one reconcile re-records the projection in the new shape. */
export const grantsDiffer = (declared: DeclaredGrants, live: PostgresGrantsAttributes): boolean => {
  if (
    declared.role !== live.role ||
    declared.database !== live.database ||
    declared.schema !== live.schema
  ) {
    return true;
  }
  if (declared.publicSchemaRevoked && !live.publicSchemaRevoked) return true;
  if (declared.publicTablesRevoked && !live.publicTablesRevoked) return true;
  if (wordsDiffer(declared.schemaPrivileges, live.schemaPrivileges)) return true;
  if (declared.tables.length !== live.tables.length) return true;
  if (
    declared.tables.some(
      (table, index) =>
        table.table !== (live.tables[index]?.table ?? null) ||
        wordsDiffer(table.privileges, live.tables[index]?.privileges ?? []),
    )
  ) {
    return true;
  }
  if (declared.columns.length !== live.columns.length) return true;
  if (
    declared.columns.some(
      (column, index) =>
        column.table !== (live.columns[index]?.table ?? null) ||
        column.column !== (live.columns[index]?.column ?? null) ||
        wordsDiffer(column.privileges, live.columns[index]?.privileges ?? []),
    )
  ) {
    return true;
  }
  if (declared.defaults.length !== live.defaults.length) return true;
  if (
    declared.defaults.some(
      (entry, index) =>
        entry.forRole !== (live.defaults[index]?.forRole ?? null) ||
        wordsDiffer(entry.privileges, live.defaults[index]?.privileges ?? []),
    )
  ) {
    return true;
  }
  return false;
};
