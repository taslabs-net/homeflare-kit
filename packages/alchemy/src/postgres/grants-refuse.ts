/**
 * The plan-time refusals of `Postgres.Grants`, checked without a client: a word outside
 * its vocabulary, a word declared both plain and `*`-marked, a duplicate object and the
 * over-long name. Pure — no client, no `Effect` — so `reconcile` and the engine's `diff`
 * refuse exactly the same way.
 */
import {
  COLUMN_PRIVILEGES,
  SCHEMA_PRIVILEGES,
  TABLE_PRIVILEGES,
  grantsNameByteRefusal,
} from './grants-attrs.ts';
import { type DeclaredGrants, baseWord } from './grants-declare.ts';

/** The first refusal inside one word list: a word outside the vocabulary (the base word of
 * a `*`-marked one, and a bare `*` is never a privilege). `undefined` when the list is
 * in scope. */
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

/** One refusal inside the resolved declaration, already discriminated for its typed error.
 * Words are checked against their vocabulary; names are checked for duplicates (two
 * entries for one table, one column pair, or one `forRole` would silently merge in the
 * sort and hide an operator's mistake). */
export type DeclarationRefusal =
  | { readonly kind: 'privilege'; readonly prop: string; readonly word: string }
  | { readonly kind: 'duplicate'; readonly prop: string; readonly name: string };

/** One refusal inside one validated word list: first a word outside its vocabulary, then
 * a base word declared both plain and `*`-marked — the server keeps ONE aclitem per
 * grantee per grantor, so `select` and `select*` cannot both hold and the set could never
 * converge (`grants-plan.test.ts` pins the refusal). */
const listRefusal = (
  words: ReadonlyArray<string>,
  vocabulary: ReadonlyArray<string>,
  prop: string,
): DeclarationRefusal | undefined => {
  const word = wordRefusal(words, vocabulary);
  if (word !== undefined) return { kind: 'privilege', prop, word };
  const seen = new Set<string>();
  for (const entry of words) {
    const base = baseWord(entry);
    if (seen.has(base)) return { kind: 'duplicate', prop, name: base };
    seen.add(base);
  }
  return undefined;
};

export const declarationRefusal = (declared: DeclaredGrants): DeclarationRefusal | undefined => {
  const schema = listRefusal(declared.schemaPrivileges, SCHEMA_PRIVILEGES, 'schemaPrivileges');
  if (schema !== undefined) return schema;
  for (const table of declared.tables) {
    const refusal = listRefusal(table.privileges, TABLE_PRIVILEGES, `tables.${table.table}`);
    if (refusal !== undefined) return refusal;
  }
  for (const column of declared.columns) {
    const refusal = listRefusal(
      column.privileges,
      COLUMN_PRIVILEGES,
      `columnGrants.${column.table}.${column.column}`,
    );
    if (refusal !== undefined) return refusal;
  }
  for (const entry of declared.defaults) {
    const refusal = listRefusal(
      entry.privileges,
      TABLE_PRIVILEGES,
      `defaultPrivileges.${entry.forRole}`,
    );
    if (refusal !== undefined) return refusal;
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
