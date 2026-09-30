/**
 * The read half of `Postgres.Grants`: what the catalogs say the declared role and PUBLIC
 * may do on one schema, its relations, its columns and its default privileges — plus the
 * existence checks the plan refuses on before any statement runs.
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
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';

/** One aclexplode row as it crosses the wire: lowercase declared word with `*` appended
 * when the privilege carries WITH GRANT OPTION (`is_grantable`). */
export interface AclRow {
  readonly public: boolean;
  readonly privilege: string;
  readonly grantable: boolean;
}

/** Lowercase word, `*` appended when the privilege carries WITH GRANT OPTION. */
export const encodeWord = (row: {
  readonly privilege: string;
  readonly grantable: boolean;
}): string => `${row.privilege.toLowerCase()}${row.grantable ? '*' : ''}`;

/** Union of one grantee's distinct words over all its aclexplode rows, sorted — two reads
 * of the same state must compare equal, which the re-run-is-a-no-op rule needs. */
export const wordsOf = (rows: ReadonlyArray<AclRow>, wantPublic: boolean): ReadonlyArray<string> =>
  [...new Set(rows.filter((row) => row.public === wantPublic).map(encodeWord))].sort();

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
 * PUBLIC, with each grantee's words — sorted by table name. */
const TABLES_SQL = `SELECT
    c.relname AS table,
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
  readonly role: ReadonlyArray<string>;
  readonly public: ReadonlyArray<string>;
}

export const readTableAcls = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<ReadonlyArray<LiveTable>, SqlError> =>
  Effect.map(pg.unsafe<AclRow & { readonly table: string }>(TABLES_SQL, [schema, role]), (rows) => {
    const byTable = new Map<string, { role: string[]; public: string[] }>();
    for (const row of rows) {
      const entry = byTable.get(row.table) ?? { role: [], public: [] };
      entry[row.public ? 'public' : 'role'].push(encodeWord(row));
      byTable.set(row.table, entry);
    }
    return [...byTable.entries()]
      .map(([table, entry]) => ({
        table,
        role: [...new Set(entry.role)].sort(),
        public: [...new Set(entry.public)].sort(),
      }))
      .sort((a, b) => a.table.localeCompare(b.table));
  });

/** One row per column ACL in the schema (user columns only: `attnum > 0`, not dropped),
 * for the declared role and PUBLIC — sorted by table then column. PUBLIC column rows are
 * read so `revokeFromPublic` converges on them too: `REVOKE ALL ON ALL TABLES IN SCHEMA`
 * clears them in the same statement, but only grants made by the revoking role or by the
 * owner (which holds every grant option) — a third grantor's grant would otherwise survive
 * past a repair with nothing re-read to notice it. */
const COLUMNS_SQL = `SELECT
    c.relname AS table,
    v.attname AS column,
    a.grantee = 0 AS public,
    a.privilege_type AS privilege,
    a.is_grantable AS grantable
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
}

export const readColumnAcls = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<ReadonlyArray<LiveColumn>, SqlError> =>
  Effect.map(
    pg.unsafe<AclRow & { readonly table: string; readonly column: string }>(COLUMNS_SQL, [
      schema,
      role,
    ]),
    (rows) => {
      const byColumn = new Map<string, { role: string[]; public: string[] }>();
      for (const row of rows) {
        const key = `${row.table}\u0000${row.column}`;
        const entry = byColumn.get(key) ?? { role: [], public: [] };
        entry[row.public ? 'public' : 'role'].push(encodeWord(row));
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
          };
        })
        .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
    },
  );

/** One row per default-privilege entry on relations (`defaclobjtype = 'r'`, the only
 * object type this family declares — `pg_default_acl.h@REL_18_6#DEFACLOBJ_RELATION`) in
 * the schema, with the declared role's words, whatever role created the entry. Sorted by
 * forRole so two reads of the same state compare equal. */
const DEFAULTS_SQL = `SELECT
    pg_get_userbyid(d.defaclrole) AS for_role,
    a.privilege_type AS privilege,
    a.is_grantable AS grantable
  FROM pg_default_acl d
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
  WHERE d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
    AND d.defaclobjtype = 'r'
    AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)
  ORDER BY for_role`;

export interface LiveDefault {
  readonly forRole: string;
  readonly role: ReadonlyArray<string>;
}

export const readDefaultAcls = (
  pg: PgExecutor,
  schema: string,
  role: string,
): Effect.Effect<ReadonlyArray<LiveDefault>, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly for_role: string } & AclRow>(DEFAULTS_SQL, [schema, role]),
    (rows) => {
      const byRole = new Map<string, string[]>();
      for (const row of rows) {
        const words = byRole.get(row.for_role) ?? [];
        words.push(encodeWord(row));
        byRole.set(row.for_role, words);
      }
      return [...byRole.entries()]
        .map(([forRole, words]) => ({ forRole, role: [...new Set(words)].sort() }))
        .sort((a, b) => a.forRole.localeCompare(b.forRole));
    },
  );

/** Everything the reconcile and diff paths need about one schema, read in one bounded
 * burst of parallel queries (one pool per operation — `withPg` opens and closes it). */
export interface LiveGrants {
  readonly schemaExists: boolean;
  readonly schema: LiveSchemaAcl;
  readonly tables: ReadonlyArray<LiveTable>;
  readonly columns: ReadonlyArray<LiveColumn>;
  readonly defaults: ReadonlyArray<LiveDefault>;
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
  });
