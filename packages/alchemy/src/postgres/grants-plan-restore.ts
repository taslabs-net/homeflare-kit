/**
 * Which removed entries a reconcile's `REVOKE ALL` will actually emit.
 *
 * Pure — the statement text stays in `grants-plan.ts`. `planRepair` counts the tables
 * returned here as already revoked, so it re-grants the column entries that revoke
 * clears and plans any still-declared columns of those tables against an empty set,
 * all from the pre-revoke read (the writes then share one transaction).
 */
import type { DeclaredGrants } from './grants-declare.ts';
import type { LiveGrants } from './grants-read.ts';

export interface RemovalRevokes {
  readonly tables: ReadonlyArray<string>;
  readonly columns: ReadonlyArray<{ readonly table: string; readonly column: string }>;
}

const tableWords = (live: LiveGrants, table: string): ReadonlyArray<string> =>
  live.tables.find((entry) => entry.table === table)?.role ?? [];

const columnWords = (live: LiveGrants, table: string, column: string): ReadonlyArray<string> =>
  live.columns.find((entry) => entry.table === table && entry.column === column)?.role ?? [];

/** Tables and columns an update removed that still show the role's words and that the
 * role does not own. An empty catalog entry emits no revoke — and must not be counted
 * as revoked, or the repair would re-grant columns the revoke never cleared. */
export const removalRevokes = (
  removed: Pick<DeclaredGrants, 'tables' | 'columns'>,
  live: LiveGrants,
): RemovalRevokes => {
  const ownedTables = new Set(live.ownedTables);
  return {
    tables: removed.tables
      .filter((table) => !ownedTables.has(table.table) && tableWords(live, table.table).length > 0)
      .map((table) => table.table),
    columns: removed.columns
      .filter(
        (column) =>
          !ownedTables.has(column.table) &&
          columnWords(live, column.table, column.column).length > 0,
      )
      .map(({ table, column }) => ({ table, column })),
  };
};
