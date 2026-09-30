/**
 * The offline half of `Postgres.Grants`' diff engine: the read-back projection
 * (`attributesOf`) and the plan-time comparison (`grantsDiffer`). Pure — no client, no
 * `Effect` — so `reconcile`'s read-back and the engine's `diff` project and compare one
 * way. The repair and revocation statement lists live in `grants-plan.ts`.
 */
import type { PostgresGrantsAttributes } from './grants-attrs.ts';
import type { DeclaredGrants, DeclaredNames } from './grants-declare.ts';
import { liveColumnWords, liveDefaultWords, liveTableWords, wordsDiffer } from './grants-plan.ts';
import type { LiveGrants } from './grants-read.ts';
import { relkindIsPublicRevocable } from './grants-words.ts';

/** The read-back projection: live catalog words, restricted to the names this declaration
 * (or, for `read`, the last one) claims — plus the one-directional PUBLIC fact and the
 * ownership facts. The PUBLIC-tables fact is scoped to the relkinds the bulk revoke
 * statement actually reaches; an owned object records an empty word list (the ACL rows say
 * nothing; ownership carries the privileges). */
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
    live.tables.every(
      (table) => !relkindIsPublicRevocable(table.relkind) || table.public.length === 0,
    ) && live.columns.every((column) => column.public.length === 0),
  schemaOwnedByRole: live.schemaOwnedByRole,
  ownedTables: names.tables.filter((table) => live.ownedTables.includes(table)),
});

/** The engine's plan-time comparison: the new declaration against the recorded (or freshly
 * read) attributes. PUBLIC is one-directional — a declaration that does not revoke
 * PUBLIC leaves whatever it holds alone, so live PUBLIC privileges with
 * `revokeFromPublic: false` are never drift. Everything else is full equality, grant-option
 * marks included; a changed NAME SET (a table added to or removed from the declaration)
 * answers `true` so one reconcile re-records the projection in the new shape. Owned objects
 * are skipped exactly as the repair skips them: their word list is meaningless (the owner
 * holds everything implicitly), so only a name-set change on one can answer `true`. */
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
  if (!live.schemaOwnedByRole && wordsDiffer(declared.schemaPrivileges, live.schemaPrivileges)) {
    return true;
  }
  if (declared.tables.length !== live.tables.length) return true;
  const ownedTables = new Set(live.ownedTables);
  if (
    declared.tables.some(
      (table, index) =>
        table.table !== (live.tables[index]?.table ?? null) ||
        (!ownedTables.has(table.table) &&
          wordsDiffer(table.privileges, live.tables[index]?.privileges ?? [])),
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
        (!ownedTables.has(column.table) &&
          wordsDiffer(column.privileges, live.columns[index]?.privileges ?? [])),
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
