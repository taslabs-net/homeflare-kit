/**
 * `Postgres.Grants`' declared shape, normalized: every default applied, every list sorted,
 * the names recovered from the persisted attributes, the cleared twin `delete` replays and
 * the entries an update removed. Pure — no client, no `Effect` — so `reconcile`, the
 * engine's `diff` and the tests share one implementation. Word validation and the refusals
 * live in `grants-refuse.ts`; the comparison against live catalogs and the read-back
 * projection in `grants-plan.ts` and `grants-diff.ts`.
 *
 * ★ WHAT THE RESOURCE OWNS, PRECISELY. For every object the declaration NAMES — the schema,
 *   each table, each column, each (`forRole`) default — the role's full privilege set is
 *   declared; an object the declaration does not name is NEVER touched. PUBLIC's privileges
 *   are touched only when `revokeFromPublic` says so, and only by clearing: this family
 *   never issues a `GRANT … TO PUBLIC`.
 */
import type { PostgresGrantsAttributes, PostgresGrantsProps } from './grants-attrs.ts';

/** The resolved declaration: every default applied, every word validated, every list
 * sorted. Both the live bundle (`grants-read.ts`) and the persisted attributes are already
 * in these shapes. */
export interface DeclaredGrants {
  readonly role: string;
  readonly database: string;
  readonly schema: string;
  readonly schemaPrivileges: ReadonlyArray<string>;
  readonly tables: ReadonlyArray<{
    readonly table: string;
    readonly privileges: ReadonlyArray<string>;
  }>;
  readonly columns: ReadonlyArray<{
    readonly table: string;
    readonly column: string;
    readonly privileges: ReadonlyArray<string>;
  }>;
  readonly defaults: ReadonlyArray<{
    readonly forRole: string;
    readonly privileges: ReadonlyArray<string>;
  }>;
  readonly publicSchemaRevoked: boolean;
  readonly publicTablesRevoked: boolean;
}

const cleanWords = (words: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(words)].sort();

export const baseWord = (word: string): string => (word.endsWith('*') ? word.slice(0, -1) : word);

/** The one place defaults resolve to values: `schemaUsage` true, `schemaCreate` false, the
 * PUBLIC revokes false. Every caller — plan, reconcile, diff — normalizes through here so
 * the three never disagree on what an omitted prop means. */
export const resolveProps = (props: PostgresGrantsProps): DeclaredGrants => ({
  role: props.role,
  database: props.database,
  schema: props.schema,
  schemaPrivileges: cleanWords([
    ...(props.schemaUsage === false ? [] : ['usage']),
    ...(props.schemaCreate === true ? ['create'] : []),
  ]),
  tables: [...(props.tables ?? [])]
    .map((table) => ({ table: table.table, privileges: cleanWords(table.privileges) }))
    .sort((a, b) => a.table.localeCompare(b.table)),
  columns: [...(props.columnGrants ?? [])]
    .map((column) => ({
      table: column.table,
      column: column.column,
      privileges: cleanWords(column.privileges),
    }))
    .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column)),
  defaults: [...(props.defaultPrivileges ?? [])]
    .map((entry) => ({ forRole: entry.forRole, privileges: cleanWords(entry.privileges) }))
    .sort((a, b) => a.forRole.localeCompare(b.forRole)),
  publicSchemaRevoked: props.revokeFromPublic === true,
  publicTablesRevoked: props.revokeFromPublic === true,
});

/** Split one validated word list by its grant-option mark: a mixed list cannot be a single
 * `GRANT` (one `WITH GRANT OPTION` clause would grant the option to every listed
 * privilege, `grants-sql.ts`'s header), so the repair issues one statement per group. */
export const splitGrantWords = (
  words: ReadonlyArray<string>,
): { readonly plain: ReadonlyArray<string>; readonly grantable: ReadonlyArray<string> } => ({
  plain: words.filter((word) => !word.endsWith('*')),
  grantable: words.filter((word) => word.endsWith('*')),
});

/** The names the live read is PROJECTED onto — attributes record what the catalogs say,
 * restricted to the objects one declaration names (an object the declaration never named
 * must not appear in them: the engine's diff would read it as drift the repair is forbidden
 * to touch). */
export interface DeclaredNames {
  readonly role: string;
  readonly database: string;
  readonly schema: string;
  readonly tables: ReadonlyArray<string>;
  readonly columns: ReadonlyArray<{ readonly table: string; readonly column: string }>;
  readonly defaults: ReadonlyArray<string>;
}

export const declaredNames = (declared: DeclaredGrants): DeclaredNames => ({
  role: declared.role,
  database: declared.database,
  schema: declared.schema,
  tables: declared.tables.map((table) => table.table),
  columns: declared.columns.map(({ table, column }) => ({ table, column })),
  defaults: declared.defaults.map((entry) => entry.forRole),
});

/** Recover the last declaration's names from the persisted attributes, for `read`'s
 * projection when a state file exists (`attributesOf` uses only the names; the recorded
 * words are the catalogs' to decide). */
export const namesFromAttrs = (attrs: PostgresGrantsAttributes): DeclaredNames => ({
  role: attrs.role,
  database: attrs.database,
  schema: attrs.schema,
  tables: attrs.tables.map((table) => table.table),
  columns: attrs.columns.map(({ table, column }) => ({ table, column })),
  defaults: attrs.defaults.map((entry) => entry.forRole),
});

/** The `delete` twin of a declaration: the same names, every privilege list emptied, the
 * PUBLIC flags off. `planRepair` turns it into exactly the revoke set delete may issue —
 * one revoke per named object where live still shows the role words, nothing for PUBLIC
 * (a delete never re-grants what a revoke cleared). */
export const clearedDeclaration = (declared: DeclaredGrants): DeclaredGrants => ({
  ...declared,
  schemaPrivileges: [],
  tables: declared.tables.map((table) => ({ table: table.table, privileges: [] })),
  columns: declared.columns.map((column) => ({
    table: column.table,
    column: column.column,
    privileges: [],
  })),
  defaults: declared.defaults.map((entry) => ({ forRole: entry.forRole, privileges: [] })),
  publicSchemaRevoked: false,
  publicTablesRevoked: false,
});

/** The entries an update REMOVED from the last applied declaration: the names in
 * `output` (the persisted attributes) that the new declaration no longer names, every
 * word list emptied — the input `grants-plan.ts#planRevocations` turns into the revoke set
 * the reconcile runs before the new declaration's repair, so removing an entry takes the
 * privilege away instead of silently retaining it. `undefined` when `output` is undefined
 * (first apply) or nothing was removed. The `database`-mismatch and retarget guards run
 * first, so the removed set can only ever hold tables, columns and defaults — the schema
 * class never gains or loses an entry. */
export const removedNames = (
  output: PostgresGrantsAttributes | undefined,
  declared: DeclaredGrants,
): Pick<DeclaredGrants, 'schema' | 'role' | 'tables' | 'columns' | 'defaults'> | undefined => {
  if (output === undefined) return undefined;
  const keepTables = new Set(declared.tables.map((table) => table.table));
  const keepColumns = new Set(
    declared.columns.map((column) => `${column.table}\u0000${column.column}`),
  );
  const keepDefaults = new Set(declared.defaults.map((entry) => entry.forRole));
  const tables = output.tables
    .filter((table) => !keepTables.has(table.table))
    .map((table) => ({ table: table.table, privileges: [] as ReadonlyArray<string> }));
  const columns = output.columns
    .filter((column) => !keepColumns.has(`${column.table}\u0000${column.column}`))
    .map((column) => ({
      table: column.table,
      column: column.column,
      privileges: [] as ReadonlyArray<string>,
    }));
  const defaults = output.defaults
    .filter((entry) => !keepDefaults.has(entry.forRole))
    .map((entry) => ({ forRole: entry.forRole, privileges: [] as ReadonlyArray<string> }));
  if (tables.length === 0 && columns.length === 0 && defaults.length === 0) return undefined;
  return { schema: declared.schema, role: declared.role, tables, columns, defaults };
};
