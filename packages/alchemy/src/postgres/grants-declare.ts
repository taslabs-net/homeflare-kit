/**
 * `Postgres.Grants`' declared shape, normalized: every default applied, every word validated,
 * every list sorted. Pure — no client, no `Effect` — so `reconcile`, the engine's `diff` and
 * the tests share one implementation. The comparison against live catalogs and the read-back
 * projection live in `grants-plan.ts`.
 *
 * ★ WHAT THE RESOURCE OWNS, PRECISELY. For every object the declaration NAMES — the schema,
 *   each table, each column, each (`forRole`) default — the role's full privilege set is
 *   declared; an object the declaration does not name is NEVER touched. PUBLIC's privileges
 *   are touched only when `revokeFromPublic` says so, and only by clearing: this family
 *   never issues a `GRANT … TO PUBLIC`.
 */
import {
  COLUMN_PRIVILEGES,
  SCHEMA_PRIVILEGES,
  TABLE_PRIVILEGES,
  grantsNameByteRefusal,
} from './grants-attrs.ts';
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

/** The first refusal inside one word list: a word outside the vocabulary (the base word of
 * a `*`-marked one, and a bare `*` is never a privilege). `undefined` when the list is
 * in scope. The refusal carries the word as declared, so the typed error names exactly
 * what the operator wrote. */
const wordRefusal = (
  words: ReadonlyArray<string>,
  vocabulary: ReadonlyArray<string>,
): string | undefined => {
  for (const word of words) {
    if (word === '*') return word;
    const bare = baseWord(word);
    if (!vocabulary.includes(bare as never)) return bare;
  }
  return undefined;
};

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

/** One refusal inside the resolved declaration, already discriminated for its typed error.
 * Words are checked against their vocabulary; names are checked for duplicates (two
 * entries for one table, one column pair, or one `forRole` would silently merge in the
 * sort and hide an operator's mistake). */
export type DeclarationRefusal =
  | { readonly kind: 'privilege'; readonly prop: string; readonly word: string }
  | { readonly kind: 'duplicate'; readonly prop: string; readonly name: string };

export const declarationRefusal = (declared: DeclaredGrants): DeclarationRefusal | undefined => {
  const refused = wordRefusal(declared.schemaPrivileges, SCHEMA_PRIVILEGES);
  if (refused !== undefined) return { kind: 'privilege', prop: 'schemaPrivileges', word: refused };
  for (const table of declared.tables) {
    const word = wordRefusal(table.privileges, TABLE_PRIVILEGES);
    if (word !== undefined) {
      return { kind: 'privilege', prop: `tables.${table.table}`, word };
    }
  }
  for (const column of declared.columns) {
    const word = wordRefusal(column.privileges, COLUMN_PRIVILEGES);
    if (word !== undefined) {
      return { kind: 'privilege', prop: `columnGrants.${column.table}.${column.column}`, word };
    }
  }
  for (const entry of declared.defaults) {
    const word = wordRefusal(entry.privileges, TABLE_PRIVILEGES);
    if (word !== undefined) {
      return { kind: 'privilege', prop: `defaultPrivileges.${entry.forRole}`, word };
    }
  }
  const duplicate = (names: ReadonlyArray<string>): string | undefined => {
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) return name;
      seen.add(name);
    }
    return undefined;
  };
  const table = duplicate(declared.tables.map((entry) => entry.table));
  if (table !== undefined) return { kind: 'duplicate', prop: 'tables', name: table };
  const column = duplicate(declared.columns.map((entry) => `${entry.table}\0${entry.column}`));
  if (column !== undefined)
    return { kind: 'duplicate', prop: 'columnGrants', name: column.replace('\0', '.') };
  const forRole = duplicate(declared.defaults.map((entry) => entry.forRole));
  if (forRole !== undefined) return { kind: 'duplicate', prop: 'defaultPrivileges', name: forRole };
  return undefined;
};

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

/** Refuse the first declared name the server would silently truncate — the grantee role,
 * the database, the schema, every table, every table-and-column pair, every `forRole`
 * (roles, schemas, tables and columns are all `NameData`; the same limit
 * `Postgres.Database` enforces). `undefined` when every name is in range. */
export const grantsNamesRefusal = (
  declared: DeclaredGrants,
): { readonly name: string; readonly byteLength: number; readonly limit: number } | undefined => {
  const names = [
    declared.role,
    declared.database,
    declared.schema,
    ...declared.tables.map((table) => table.table),
    ...declared.columns.flatMap((column) => [column.table, column.column]),
    ...declared.defaults.map((entry) => entry.forRole),
  ];
  for (const name of names) {
    const refusal = grantsNameByteRefusal(name);
    if (refusal !== undefined) return { name, ...refusal };
  }
  return undefined;
};

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
