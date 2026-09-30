/**
 * `Postgres.Grants`' declared shapes: the three privilege vocabularies (schema, table,
 * column), the ACL letters `aclitem` text stores them as, and the props/attributes surfaces.
 *
 * ⛔ NO SUPERUSER-ISH OPTION EXISTS HERE BY CONSTRUCTION. This resource's only vocabularies
 *   are `CREATE`/`USAGE` (schemas) and the table/column sets below — none of the server's
 *   other object classes, and no role membership, ownership, `SUPERUSER`, `CREATEROLE`,
 *   `BYPASSRLS` or parameter right is expressible. `docs/postgres-grants.md#scope` documents
 *   what that means operationally: an object's OWNER (or a superuser) holds everything
 *   regardless of ACL rows, and this resource cannot make anyone an owner.
 * ★ EVERY VOCABULARY IS BACKED BY THE GRANT SYNTAX AT REL_18_6. The table set is
 *   `ACL_ALL_RIGHTS_RELATION` and the schema set is `ACL_ALL_RIGHTS_SCHEMA` (both
 *   `acl.h@REL_18_6`, asserted in `grants-provenance.test.ts`); the column set is
 *   `ACL_ALL_RIGHTS_COLUMN` and the column synopsis (`grant.sgml@REL_18_6`):
 *   `GRANT { { SELECT | INSERT | UPDATE | REFERENCES } ( column_name … )` — `TRUNCATE`,
 *   `TRIGGER` and `MAINTAIN` are table-wide only, so they are refused for a column.
 * ⛔ WORDS ARE STORED LOWERCASE, LETTERS ARE THE SERVER'S. Attributes carry privilege
 *   WORDS (`"select"`, `"select*"` — trailing `*` marks WITH GRANT OPTION, exactly the mark
 *   the server records as `is_grantable`), never ACL letters: a persisted state file must
 *   read as what was declared, and the letter↔word map lives only in code against `acl.h`'s
 *   `ACL_*_CHR` defines (pinned by `grants-acl.test.ts`).
 */
import { POSTGRES_NAME_MAX_BYTES, utf8ByteLength } from './database-attrs.ts';

/** Every schema privilege `GRANT … ON SCHEMA` accepts at REL_18_6 (`ACL_ALL_RIGHTS_SCHEMA`).
 * `CREATE` lets the role create objects IN the schema; `USAGE` lets it use objects already
 * there. `schemaUsage` defaults true (a role declared into a schema it cannot even resolve
 * is almost always a mistake), `schemaCreate` defaults false (create is a real power). */
export const SCHEMA_PRIVILEGES = ['usage', 'create'] as const;
export type SchemaPrivilege = (typeof SCHEMA_PRIVILEGES)[number];

/** Every table privilege `GRANT … ON TABLE` accepts at REL_18_6
 * (`ACL_ALL_RIGHTS_RELATION`). Views are relations with these same letters. */
export const TABLE_PRIVILEGES = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
  'maintain',
] as const;
export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

/** Every column privilege the column synopsis accepts at REL_18_6
 * (`ACL_ALL_RIGHTS_COLUMN`) — the intersection of the table set with what a single column
 * can carry, measured from `grant.sgml`'s own column form, asserted in
 * `grants-provenance.test.ts`. */
export const COLUMN_PRIVILEGES = ['select', 'insert', 'update', 'references'] as const;
export type ColumnPrivilege = (typeof COLUMN_PRIVILEGES)[number];

/** Every word across the three vocabularies — the superset the statement builders
 * (`grants-sql.ts`) validate each privilege against before it ever reaches a `GRANT`
 * clause, so a word that no class declares can never be concatenated into SQL. */
export const ALL_GRANT_WORDS: ReadonlyArray<string> = [...SCHEMA_PRIVILEGES, ...TABLE_PRIVILEGES];

/** The `ACL_*_CHR` letters (`acl.h@REL_18_6`, lines 103-115 of the committed excerpt),
 * `_CHR` define name split into the word this family declares and the letter the server
 * stores. ⚠️ CASE IS MEANINGFUL: `C` is CREATE (schemas, the uppercase one) while `c` is
 * CONNECT (databases) — two different rights, and this map is the one place that knows. */
const LETTER_FOR_PRIVILEGE: Readonly<Record<string, string>> = {
  insert: 'a',
  select: 'r',
  update: 'w',
  delete: 'd',
  truncate: 'D',
  references: 'x',
  trigger: 't',
  maintain: 'm',
  usage: 'U',
  create: 'C',
};

export const letterForPrivilege = (word: string): string => {
  const letter = LETTER_FOR_PRIVILEGE[word];
  if (letter === undefined) throw new Error(`grants-attrs: no ACL letter for "${word}"`);
  return letter;
};

/** One declared table grant. `privileges` holds words; a trailing `*` on a word means
 * WITH GRANT OPTION for that privilege. Default privileges (for future tables) are a
 * separate prop — this one never touches `pg_default_acl`. */
export interface PostgresGrantsTable {
  readonly table: string;
  readonly privileges: ReadonlyArray<string>;
}

/** One declared column grant, from the synopsis' own column form:
 * `GRANT … ON TABLE t ( c )` (`grant.sgml@REL_18_6`). */
export interface PostgresGrantsColumn {
  readonly table: string;
  readonly column: string;
  readonly privileges: ReadonlyArray<string>;
}

/** One declared default-privileges entry. PostgreSQL records one
 * `pg_default_acl` row per (defaclrole, defaclnamespace, defaclobjtype); `forRole` is the
 * role whose FUTURE objects get the privilege (`FOR ROLE <target_role>` in
 * `ALTER DEFAULT PRIVILEGES`) and is REQUIRED — the resource never infers the connecting
 * role, so every entry reads back as exactly the role it names. The privileges apply to
 * future TABLES (DEFACLOBJ_RELATION `'r'`, the only objtype this family writes). */
export interface PostgresGrantsDefault {
  readonly forRole: string;
  readonly privileges: ReadonlyArray<string>;
}

/** The declared grant set: one role, in one schema of one database.
 *
 * `role` is a group role a human owns the membership of — roles come from elsewhere (the
 * operator, or a role resource in this family once one lands); this resource only writes
 * ACL rows. `database` names the cluster-side database the statements run IN — never
 * `ALTER DATABASE` privileges, which this family does not issue — and `reconcile` refuses
 * a declaration whose `database` differs from the one the connection actually opened. `revokeFromPublic` strips PUBLIC's default
 * SELECT (PG18 stopped granting PUBLIC CREATE on `public`, `ddl.sgml@REL_18_6`; SELECT
 * remains, so a revoke is the only way a table is truly group-private).
 */
export interface PostgresGrantsProps {
  readonly role: string;
  readonly database: string;
  readonly schema: string;
  /** `GRANT USAGE ON SCHEMA` (`pg_namespace.nspacl`). @default true */
  readonly schemaUsage?: boolean;
  /** `GRANT CREATE ON SCHEMA` (`pg_namespace.nspacl`). @default false */
  readonly schemaCreate?: boolean;
  readonly tables?: ReadonlyArray<PostgresGrantsTable>;
  readonly columnGrants?: ReadonlyArray<PostgresGrantsColumn>;
  readonly defaultPrivileges?: ReadonlyArray<PostgresGrantsDefault>;
  /** `REVOKE ALL ON SCHEMA/ALL TABLES IN SCHEMA FROM PUBLIC` (ddl.sgml: an empty grantee
   * stands for PUBLIC). @default false */
  readonly revokeFromPublic?: boolean;
}

/** Live attributes, read back from the catalogs after reconcile. Arrays are sorted
 * (schema tables, then columns) so a persisted state file compares stably, and every word
 * set is restricted to the objects THIS declaration names (see `attributesOf` in
 * `grants-plan.ts`). `publicSchemaRevoked`/`publicTablesRevoked` record the one-directional
 * PUBLIC fact the catalogs answer: PUBLIC holds nothing on the schema itself / on any
 * relation or column in it. `schemaOwnedByRole`/`ownedTables` record the ownership facts
 * the catalogs answer: the declared role OWNS the schema / those relations, so it holds
 * every privilege on them implicitly — the projection records an empty word list for an
 * owned object (the ACL rows say nothing) and the repair leaves owned objects' ACL rows
 * alone, because a `REVOKE` cannot take an owner's implicit rights away. */
export interface PostgresGrantsAttributes {
  readonly role: string;
  readonly database: string;
  readonly schema: string;
  readonly schemaPrivileges: ReadonlyArray<string>;
  readonly tables: ReadonlyArray<PostgresGrantsAttributesTable>;
  readonly columns: ReadonlyArray<PostgresGrantsAttributesColumn>;
  readonly defaults: ReadonlyArray<PostgresGrantsAttributesDefault>;
  readonly publicSchemaRevoked: boolean;
  readonly publicTablesRevoked: boolean;
  readonly schemaOwnedByRole: boolean;
  readonly ownedTables: ReadonlyArray<string>;
}

export interface PostgresGrantsAttributesTable {
  readonly table: string;
  readonly privileges: ReadonlyArray<string>;
}

export interface PostgresGrantsAttributesColumn {
  readonly table: string;
  readonly column: string;
  readonly privileges: ReadonlyArray<string>;
}

export interface PostgresGrantsAttributesDefault {
  readonly forRole: string;
  readonly privileges: ReadonlyArray<string>;
}

/** Refuse a name the server would truncate (`NAMEDATALEN`, the same limit
 * `Postgres.Database` enforces — roles, schemas, tables and columns are all `NameData`).
 * Named `grantsNameByteRefusal` so the barrel can export it beside database-attrs' own
 * `nameByteRefusal` without a collision. */
export const grantsNameByteRefusal = (
  name: string,
): { readonly byteLength: number; readonly limit: number } | undefined => {
  const byteLength = utf8ByteLength(name);
  return byteLength > POSTGRES_NAME_MAX_BYTES
    ? { byteLength, limit: POSTGRES_NAME_MAX_BYTES }
    : undefined;
};
