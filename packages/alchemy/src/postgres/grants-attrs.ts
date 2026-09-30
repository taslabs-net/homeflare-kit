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
 *   aclitem text writes), never ACL letters: a persisted state file must read as what was
 *   declared, and the letter↔word map lives only in code against `acl.h`'s `ACL_*_CHR`
 *   defines.
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

/** Parse one `aclitem` string — `grantee=privs/grantor` (`aclitemout`, `utils/adt/acl.c`;
 * the docs' worked example `ddl.sgml@REL_18_6`: `miriam=arwdDxtm/miriam`, `=r/miriam`,
 * `calvin=r*w/hobbes`). An empty grantee means PUBLIC. `undefined` when the text is not
 * that shape (a column wider than one aclitem would be a server-side change; fail loud, S21,
 * rather than mis-reading one). */
export interface ParsedAclItem {
  readonly grantee: string;
  readonly letters: string;
  readonly grantor: string;
}

/** Un-quote one `aclitem` id the way `aclitemin`'s `getid` reads it back: `"a""b"` is
 * `a"b`. A bare identifier (no quotes) is returned as-is. `value` is `undefined` when the
 * text runs out mid-quote (never produced by `aclitemout`; fail loud, S21). */
const scanAclId = (
  text: string,
  start: number,
): { readonly value: string | undefined; readonly end: number } => {
  if (text[start] !== '"') {
    let i = start;
    while (i < text.length && text[i] !== '=' && text[i] !== '/') i += 1;
    return { value: text.slice(start, i), end: i };
  }
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const char = text[i] as string;
    if (char === '"') {
      if (text[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      return { value: out, end: i + 1 };
    }
    out += char;
    i += 1;
  }
  return { value: undefined, end: text.length };
};

/** Parse one `aclitem` string — `grantee=privs/grantor` (`aclitemout`, `utils/adt/acl.c`;
 * the docs' worked example `ddl.sgml@REL_18_6`: `miriam=arwdDxtm/miriam`, `=r/miriam`,
 * `calvin=r*w/hobbes`). An empty grantee means PUBLIC. Grantee and grantor may be
 * `"`-quoted (a quoted id may contain `=` or `/`, and `""` inside it is one `"`).
 * `undefined` when the text is not exactly one aclitem (fail loud in the caller, S21,
 * rather than mis-read one). */
export const parseAclItem = (text: string): ParsedAclItem | undefined => {
  const grantee = scanAclId(text, 0);
  if (grantee.value === undefined || text[grantee.end] !== '=') return undefined;
  const slash = text.indexOf('/', grantee.end + 1);
  if (slash < 0) return undefined;
  const letters = text.slice(grantee.end + 1, slash);
  const grantor = scanAclId(text, slash + 1);
  if (grantor.value === undefined || grantor.end !== text.length) return undefined;
  if (letters.length === 0) return undefined;
  return { grantee: grantee.value, letters, grantor: grantor.value };
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
 * `ALTER DEFAULT PRIVILEGES`, omitted when it is the connecting role itself), and the
 * privileges apply to future TABLES (DEFACLOBJ_RELATION `'r'`, the only objtype this
 * family writes). */
export interface PostgresGrantsDefault {
  readonly forRole?: string;
  readonly privileges: ReadonlyArray<string>;
}

/** The declared grant set: one role, in one schema of one database.
 *
 * `role` is a group role a human owns the membership of — `Postgres.Role` (a separate
 * resource, kit#324's family) creates roles; this resource only writes ACL rows.
 * `database` names the cluster-side database the statements run IN — never `ALTER DATABASE`
 * privileges, which this family does not issue. `revokeFromPublic` strips PUBLIC's default
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
 * (schema tables, then columns) so a persisted state file compares stably. */
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
 * `Postgres.Database` enforces — roles, schemas, tables and columns are all `NameData`). */
export const nameByteRefusal = (
  name: string,
): { readonly byteLength: number; readonly limit: number } | undefined => {
  const byteLength = utf8ByteLength(name);
  return byteLength > POSTGRES_NAME_MAX_BYTES
    ? { byteLength, limit: POSTGRES_NAME_MAX_BYTES }
    : undefined;
};
