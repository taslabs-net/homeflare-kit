/**
 * The read half of `Postgres.Grants`: what the catalogs say the declared role and PUBLIC
 * may do on one schema, its relations, its columns and its default privileges — plus the
 * existence check the plan refuses on before any statement runs. The ownership facts
 * (`nspowner`/`relowner`) live in `grants-ownership.ts`; the word vocabulary and the
 * PUBLIC relkind set live in `grants-words.ts`.
 *
 * ★ READS GO THROUGH `aclexplode`, NOT THE `aclitem` TEXT. Measured at
 *   `func.sgml@REL_18_6` ("Access Privilege Inquiry Functions", committed as
 *   `fixtures/pg-REL_18_6-aclexplode-func.txt`): `aclexplode(aclitem[])` returns
 *   `(grantor oid, grantee oid, privilege_type text, is_grantable boolean)`, one row per
 *   granted privilege, with the PUBLIC pseudo-role at grantee oid zero — so the read path
 *   never parses `grantee=privs/grantor` letters at all. The letters still appear in
 *   `grants-provenance.test.ts`, where the declared words are traced to the `ACL_*_CHR`
 *   constants the server really stores, but no shipped query depends on them.
 * ★ `grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)` IS MISSING-ROLE-SAFE BY
 *   CONSTRUCTION: a role that does not exist yields `NULL`, `NULL = anything` is `NULL`,
 *   and `WHERE NULL` selects nothing — the role simply reads as holding no privileges.
 * ★ `relkind` IS NOT FILTERED. A schema's `pg_class` rows carry `relacl` whether the
 *   relation is a table, a view or a sequence, and the seat model grants SELECT on a
 *   shared ledger VIEW in another schema through the same `GRANT … ON` statement the docs'
 *   table form accepts for views (`grant.sgml@REL_18_6`: "ALL TABLES also affects views
 *   and foreign tables"). A word the relkind cannot hold (e.g. INSERT on a sequence) is
 *   refused by the server itself as a statement error, never by a word check: deciding
 *   that at plan time would need a second relkind query this family does not read.
 * ★ `relkind` IS CAST TO TEXT (`c.relkind::text`) BECAUSE THE COLUMN IS TYPE `"char"`
 *   (OID 18), which `@effect/sql-pg`'s socket transport does not decode: `PgTypes` has
 *   no codec for OID 18, so the raw `bytea`-shaped bytes arrive (a plain table reads as
 *   `Uint8Array([114])`, never `'r'`) and `relkindIsPublicRevocable` (`grants-words.ts`)
 *   would say PUBLIC holds nothing a `REVOKE ALL ON ALL TABLES IN SCHEMA` reaches.
 *   `::text` returns OID 25, which decodes as a string. Same trap as the `datlocprovider`
 *   CASE in `database-sql.ts`, which casts `"char"` columns to text for the same reason.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import { readOwnedTables, readSchemaOwnership } from './grants-ownership.ts';
import { type LiveDefault, readDefaultAcls } from './grants-read-defaults.ts';
import { type AclRow, encodeWord, wordsOf } from './grants-words.ts';

const SCHEMA_PRESENT_SQL = 'SELECT 1 AS present FROM pg_namespace WHERE nspname = $1';

export const schemaExists = (pg: PgExecutor, schema: string): Effect.Effect<boolean, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly present: number }>(SCHEMA_PRESENT_SQL, [schema]),
    (rows) => rows.length > 0,
  );

/** Schema-level rows for the declared role and for PUBLIC in one query: the repair target
 * (`role`) and the `revokeFromPublic` check (`public`) share one round trip. */
const SCHEMA_ACL_SQL = `SELECT
    a.grantee = 0 AS public,
    a.privilege_type AS privilege,
    a.is_grantable AS grantable
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(n.nspacl) AS a
  WHERE n.nspname = $1
    AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2))`;

export interface LiveSchemaAcl {
  readonly role: ReadonlyArray<string>;
  readonly public: ReadonlyArray<string>;
}

export const readSchemaAcl = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<LiveSchemaAcl, SqlError> =>
  Effect.map(pg.unsafe<AclRow>(SCHEMA_ACL_SQL, [schema, role]), (rows) => ({
    role: wordsOf(rows, false),
    public: wordsOf(rows, true),
  }));

/** One row per relation in the schema that holds ANY acl entry for the declared role or
 * PUBLIC, with each grantee's words and the relation's `relkind` — sorted by table name.
 * The relkind is NOT a filter on what is read (see the header): it scopes the
 * `revokeFromPublic` CHECK to the relations `REVOKE ALL ON ALL TABLES IN SCHEMA` actually
 * reaches (measured on PG 18.6: a PUBLIC grant on a sequence survives that statement, so
 * counting it would refuse to converge). */
const TABLES_SQL = `SELECT
    c.relname AS table,
    c.relkind::text AS relkind,
    a.grantee = 0 AS public,
    a.privilege_type AS privilege,
    a.is_grantable AS grantable
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) AS a
  WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
    AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2))
  ORDER BY c.relname`;

export interface LiveTable {
  readonly table: string;
  readonly relkind: string;
  readonly role: ReadonlyArray<string>;
  readonly public: ReadonlyArray<string>;
}

export const readTableAcls = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<ReadonlyArray<LiveTable>, SqlError> =>
  Effect.map(
    pg.unsafe<AclRow & { readonly table: string; readonly relkind: string }>(TABLES_SQL, [
      schema,
      role,
    ]),
    (rows) => {
      const byTable = new Map<string, { relkind: string; role: string[]; public: string[] }>();
      for (const row of rows) {
        const entry = byTable.get(row.table) ?? { relkind: row.relkind, role: [], public: [] };
        entry[row.public ? 'public' : 'role'].push(encodeWord(row));
        byTable.set(row.table, entry);
      }
      return [...byTable.entries()]
        .map(([table, entry]) => ({
          table,
          relkind: entry.relkind,
          role: [...new Set(entry.role)].sort(),
          public: [...new Set(entry.public)].sort(),
        }))
        .sort((a, b) => a.table.localeCompare(b.table));
    },
  );

/** One row per column ACL in the schema (user columns only: `attnum > 0`, not dropped),
 * for the declared role and PUBLIC — sorted by table then column. PUBLIC column rows are
 * read so `revokeFromPublic` converges on them too: `REVOKE ALL ON ALL TABLES IN SCHEMA`
 * clears them in the same statement, but only grants made by the revoking role or by the
 * owner (which holds every grant option) — a third grantor's grant would otherwise survive
 * past a repair with nothing re-read to notice it.
 *
 * `grantor` is selected for the same rule on a table-level `REVOKE ALL` (revoke.sgml@REL_18_6:
 * a role revokes only what it granted; a superuser's REVOKE is performed as the owner).
 * `restorable` is those words — the collateral re-grant restores them and leaves a third
 * grantor's entry where the revoke left it, instead of adding an owner grant on top.
 * `revoker_as_owner` gates the `grantor === owner` arm: the revoker clears the owner's grant
 * only when it revokes AS the owner — a superuser or a member of the owning role
 * (`pg_has_role(..., 'USAGE')`, `select_best_grantor` acl.c@REL_18_6). A non-superuser,
 * non-member revoker clears only grants it made, so an owner grant marked restorable would be re-granted over an entry the revoke never removed. */
const COLUMNS_SQL = `SELECT
    c.relname AS table,
    v.attname AS column,
    a.grantee = 0 AS public,
    a.privilege_type AS privilege,
    a.is_grantable AS grantable,
    pg_get_userbyid(a.grantor) AS grantor,
    pg_get_userbyid(c.relowner) AS owner,
    current_user AS revoker,
    pg_has_role(current_user, c.relowner, 'USAGE') AS revoker_as_owner
  FROM pg_attribute v
  JOIN pg_class c ON c.oid = v.attrelid
  CROSS JOIN LATERAL aclexplode(v.attacl) AS a
  WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
    AND v.attnum > 0
    AND NOT v.attisdropped
    AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2))
  ORDER BY c.relname, v.attname`;

export interface LiveColumn {
  readonly table: string;
  readonly column: string;
  readonly role: ReadonlyArray<string>;
  readonly public: ReadonlyArray<string>;
  /** Role words granted by `current_user`, or by the relation owner when this session revokes
   * AS the owner (superuser or owner-member) — what a table `REVOKE ALL` here actually clears. */
  readonly restorable: ReadonlyArray<string>;
}

export const readColumnAcls = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<ReadonlyArray<LiveColumn>, SqlError> =>
  Effect.map(
    pg.unsafe<
      AclRow & {
        readonly table: string;
        readonly column: string;
        readonly grantor: string;
        readonly owner: string;
        readonly revoker: string;
        readonly revoker_as_owner: boolean;
      }
    >(COLUMNS_SQL, [schema, role]),
    (rows) => {
      const byColumn = new Map<
        string,
        { role: string[]; public: string[]; restorable: string[] }
      >();
      for (const row of rows) {
        const key = `${row.table}\u0000${row.column}`;
        const entry = byColumn.get(key) ?? { role: [], public: [], restorable: [] };
        const word = encodeWord(row);
        entry[row.public ? 'public' : 'role'].push(word);
        if (
          !row.public &&
          (row.grantor === row.revoker || (row.grantor === row.owner && row.revoker_as_owner))
        ) {
          entry.restorable.push(word);
        }
        byColumn.set(key, entry);
      }
      return [...byColumn.entries()]
        .map(([key, entry]) => {
          const [table, column] = key.split('\u0000');
          return {
            table: table as string,
            column: column as string,
            role: [...new Set(entry.role)].sort(),
            public: [...new Set(entry.public)].sort(),
            restorable: [...new Set(entry.restorable)].sort(),
          };
        })
        .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
    },
  );

/** Everything the reconcile and diff paths need about one schema, read in one bounded
 * burst of parallel queries (one pool per operation — `withPg` opens and closes it).
 * `schemaOwnedByRole`/`ownedTables` are the ownership facts (pg_namespace.nspowner,
 * pg_class.relowner, `grants-ownership.ts`) the repair needs so it can LEAVE objects the
 * declared role owns alone: an owner holds every privilege implicitly, and a `REVOKE`
 * cannot take that away (`grants-plan.ts`). */
export interface LiveGrants {
  readonly schemaExists: boolean;
  readonly schema: LiveSchemaAcl;
  readonly tables: ReadonlyArray<LiveTable>;
  readonly columns: ReadonlyArray<LiveColumn>;
  readonly defaults: ReadonlyArray<LiveDefault>;
  readonly schemaOwnedByRole: boolean;
  readonly ownedTables: ReadonlyArray<string>;
}

export const readGrants = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<LiveGrants, SqlError> =>
  Effect.all({
    schemaExists: schemaExists(pg, schema),
    schema: readSchemaAcl(pg, schema, role),
    tables: readTableAcls(pg, schema, role),
    columns: readColumnAcls(pg, schema, role),
    defaults: readDefaultAcls(pg, schema, role),
    schemaOwnedByRole: readSchemaOwnership(pg, schema, role),
    ownedTables: readOwnedTables(pg, schema, role),
  });
