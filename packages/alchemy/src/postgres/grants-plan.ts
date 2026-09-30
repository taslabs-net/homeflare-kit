/**
 * The repair plan: the statement list a reconcile executes, as one pure function of the
 * declared grant set and the live catalogs — no client, no `Effect` — so `reconcile`, the
 * engine's `diff` and the tests share one implementation (the family's S10 rule holds at
 * the callers: `reconcile` re-reads live after the statements run, and re-plans: an EMPTY
 * plan is the no-op proof). The read-back projection and the plan-time comparison live in
 * `grants-diff.ts`.
 *
 * ★ REPAIR SHAPE PER CLASS: on drift, `REVOKE ALL` (clears extras and grant options) then
 *   `GRANT` the declared words (only when any are declared), split by the grant-option
 *   flag. A class that declares nothing and holds nothing live is a no-op; a class that
 *   declares nothing but holds live grants gets only the revoke — that is how `delete`
 *   (a cleared declaration, `grants-declare.ts`) revokes exactly what the old declaration
 *   named and nothing else.
 * ★ OBJECTS THE DECLARED ROLE OWNS ARE LEFT ALONE (H2): an owner holds every privilege
 *   implicitly and a `REVOKE` cannot take that away, so both plans skip owned objects —
 *   repairing them would only add ACL rows the state can never converge on, and revoking
 *   them would strip rights that existed before the resource (measured on PG 18.6: the
 *   docs' own seat example had its owner rights churned). The projection
 *   (`grants-diff.ts`) records the ownership facts so the plan-time diff skips the same
 *   objects.
 * ★ A TABLE'S `REVOKE ALL` ALSO CLEARS THAT GRANTEE'S COLUMN ENTRIES ON IT (measured on
 *   PG 18.6, and cited by the resource's own convergence check): every declared column of
 *   a table whose revoke this plan emits is therefore planned against an empty column
 *   set, so the declared words are re-granted after the table revoke in the SAME pass —
 *   without this, the re-read would answer drift and the repair would refuse.
 */
import type { DeclaredGrants } from './grants-declare.ts';
import { splitGrantWords } from './grants-declare.ts';
import type { LiveGrants } from './grants-read.ts';
import { relkindIsPublicRevocable } from './grants-words.ts';
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
export const wordsDiffer = (
  declared: ReadonlyArray<string>,
  live: ReadonlyArray<string>,
): boolean =>
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

export const liveTableWords = (live: LiveGrants, table: string): ReadonlyArray<string> =>
  live.tables.find((entry) => entry.table === table)?.role ?? [];

export const liveColumnWords = (
  live: LiveGrants,
  table: string,
  column: string,
): ReadonlyArray<string> =>
  live.columns.find((entry) => entry.table === table && entry.column === column)?.role ?? [];

export const liveDefaultWords = (live: LiveGrants, forRole: string): ReadonlyArray<string> =>
  live.defaults.find((entry) => entry.forRole === forRole)?.role ?? [];

/** Every statement the repair runs, in order. Classes whose live set already equals the
 * declared one contribute NOTHING — an already-correct declaration emits zero statements,
 * which is the re-run-is-a-no-op rule; the same function re-planned against the post-repair
 * read-back is the convergence proof (`PostgresGrantsRepairRefused` when it is not empty). */
export const planRepair = (declared: DeclaredGrants, live: LiveGrants): ReadonlyArray<string> => {
  const statements: string[] = [];
  const ownedTables = new Set(live.ownedTables);
  if (!live.schemaOwnedByRole && wordsDiffer(declared.schemaPrivileges, live.schema.role)) {
    statements.push(revokeSchemaSql(declared.schema, declared.role));
    statements.push(
      ...grantStatements(declared.schemaPrivileges, (words) =>
        grantSchemaSql(declared.schema, declared.role, words),
      ),
    );
  }
  // A table whose REVOKE is emitted ALSO loses the grantee's column privileges on it
  // (the header's measured rule), so every declared column of such a table is planned
  // against an empty column set: the declared words are re-granted after the table
  // revoke in the SAME pass instead of surfacing as drift only on the re-read.
  const revokedTables = new Set<string>();
  for (const table of declared.tables) {
    if (ownedTables.has(table.table)) continue;
    if (wordsDiffer(table.privileges, liveTableWords(live, table.table))) {
      revokedTables.add(table.table);
      statements.push(revokeTableSql(declared.schema, table.table, declared.role));
      statements.push(
        ...grantStatements(table.privileges, (words) =>
          grantTableSql(declared.schema, table.table, declared.role, words),
        ),
      );
    }
  }
  for (const column of declared.columns) {
    if (ownedTables.has(column.table)) continue;
    const liveWords = revokedTables.has(column.table)
      ? []
      : liveColumnWords(live, column.table, column.column);
    if (wordsDiffer(column.privileges, liveWords)) {
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
  // The PUBLIC-tables check is scoped to the relkinds the bulk revoke actually reaches:
  // a PUBLIC grant on a SEQUENCE in the schema survives `REVOKE ALL ON ALL TABLES IN
  // SCHEMA` (measured on PG 18.6), so counting it would refuse to converge forever.
  if (
    declared.publicTablesRevoked &&
    (live.tables.some(
      (table) => relkindIsPublicRevocable(table.relkind) && table.public.length > 0,
    ) ||
      live.columns.some((column) => column.public.length > 0))
  ) {
    statements.push(revokePublicTablesSql(declared.schema));
  }
  return statements;
};

/** Revoke-only statements for the entries an update REMOVED from the declaration: one
 * `REVOKE ALL` per removed object where the catalogs still show the role's words, so
 * taking an entry away takes the privilege away (a removal is a drift this resource
 * repairs, never a silent retention). Never the schema class (a role/database/schema
 * retarget is refused, so the schema can never gain or lose an entry), never PUBLIC,
 * never a grant, never an object the role OWNS (an owner's implicit rights are not this
 * resource's to revoke), and nothing for an object that no longer exists — it shows no
 * words. */
export const planRevocations = (
  removed: Pick<DeclaredGrants, 'schema' | 'role' | 'tables' | 'columns' | 'defaults'>,
  live: LiveGrants,
): ReadonlyArray<string> => {
  const statements: string[] = [];
  const ownedTables = new Set(live.ownedTables);
  for (const table of removed.tables) {
    if (ownedTables.has(table.table)) continue;
    if (liveTableWords(live, table.table).length > 0) {
      statements.push(revokeTableSql(removed.schema, table.table, removed.role));
    }
  }
  for (const column of removed.columns) {
    if (ownedTables.has(column.table)) continue;
    if (liveColumnWords(live, column.table, column.column).length > 0) {
      statements.push(revokeColumnSql(removed.schema, column.table, column.column, removed.role));
    }
  }
  for (const entry of removed.defaults) {
    if (liveDefaultWords(live, entry.forRole).length > 0) {
      statements.push(revokeDefaultSql(removed.schema, entry.forRole, removed.role));
    }
  }
  return statements;
};
