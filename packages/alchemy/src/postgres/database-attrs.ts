/**
 * `Postgres.Database` props and attributes, and the one prop-level check that runs before any
 * statement: the name's byte length against `NAMEDATALEN`.
 *
 * ⛔ EVERY ASSERTED PROP HERE HAS A CITED COLUMN. `docs/postgres.md#mapping` and
 *   `database-provenance.test.ts` are what make that true rather than asserted: the test parses
 *   the two committed fixtures (`create_database.sgml`'s synopsis, `pg_database.h`'s struct) and
 *   fails if a prop here has no synopsis option or no catalog column behind it.
 * ⛔ NO PASSWORD, EVER. A database has none in `pg_database` (S25) — `CREATE DATABASE` has no
 *   password option at all (`gram.y@REL_18_6#createdb_opt_name`, measured: `IDENT | CONNECTION
 *   LIMIT | ENCODING | LOCATION | OWNER | TABLESPACE | TEMPLATE`).
 */

/** NAMEDATALEN (`pg_config_manual.h@REL_18_6` line 29) minus the C string terminator: the
 * longest name the server stores without truncating. */
export const POSTGRES_NAME_MAX_BYTES = 63;

/** UTF-8 byte length, the same unit `NAMEDATALEN` counts in (`scansup.c@REL_18_6#truncate_identifier`
 * clips by `pg_mbcliplen`, a byte-oriented, multibyte-aware clip — never a JS `.length`, which
 * counts UTF-16 code units and would pass a 63-byte multibyte name that is really 70+ bytes, or
 * refuse a 63-byte name whose `.length` looks smaller). */
export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

/**
 * Declared, at-most-once-asserted properties of one database.
 *
 * Every prop here maps to a `CREATE DATABASE` `WITH` option `create_database.sgml` documents
 * AND a `pg_database` column that stores it (`database-provenance.test.ts`). `TEMPLATE`,
 * `STRATEGY` and `OID` are excluded because nothing in `pg_database` reads them back once the
 * database exists; `ICU_RULES` and `COLLATION_VERSION` are excluded for having no consumer in
 * this family today. See `docs/postgres.md#excluded`.
 */
export interface PostgresDatabaseProps {
  /** At most 63 UTF-8 bytes — refused at plan past that (`PostgresDatabaseNameRefused`). The
   * identity: a name change is a plan-time refusal, never a replace. */
  readonly name: string;
  /** A role name in `pg_roles`, asserted before create (`PostgresDatabaseOwnerMissing`) and
   * compared against `pg_get_userbyid(datdba)` on every plan thereafter. */
  readonly owner: string;
  /** `pg_encoding_to_char(datdatabase.encoding)`, e.g. `"UTF8"`. @default the template's. */
  readonly encoding?: string;
  /** `'builtin' | 'icu' | 'libc'` — `pg_database.datlocprovider` decoded
   * (`pg_collation.h@REL_18_6#collprovider_name`). @default the template's. */
  readonly localeProvider?: 'builtin' | 'icu' | 'libc';
  /** `pg_database.datcollate`. @default the template's. */
  readonly lcCollate?: string;
  /** `pg_database.datctype`. @default the template's. */
  readonly lcCtype?: string;
  /** `pg_database.datallowconn`. @default `true`. */
  readonly allowConnections?: boolean;
  /** `pg_database.datconnlimit`; `-1` means unlimited. @default `-1`. */
  readonly connectionLimit?: number;
  /** `pg_database.datistemplate`. @default `false`. */
  readonly isTemplate?: boolean;
  /** A tablespace name in `pg_tablespace`. @default the template's (usually `pg_default`). */
  readonly tablespace?: string;
}

/** Live attributes, read back after every reconcile. No `password` — see the file header. */
export interface PostgresDatabaseAttributes {
  readonly name: string;
  readonly oid: number;
  readonly owner: string;
  readonly encoding: string;
  readonly localeProvider: 'builtin' | 'icu' | 'libc';
  readonly collate: string;
  readonly ctype: string;
  readonly allowConnections: boolean;
  readonly connectionLimit: number;
  readonly isTemplate: boolean;
  readonly tablespace: string;
}

/**
 * Refuse a name the server would truncate, before any statement is built.
 *
 * ★ CALLED FROM `diff` (so a plan fails, never a deploy) AND FROM `reconcile` (so a fake or a
 *   direct call gets the same refusal, never just a broken statement).
 */
export const nameByteRefusal = (
  name: string,
): { readonly byteLength: number; readonly limit: number } | undefined => {
  const byteLength = utf8ByteLength(name);
  return byteLength > POSTGRES_NAME_MAX_BYTES
    ? { byteLength, limit: POSTGRES_NAME_MAX_BYTES }
    : undefined;
};
