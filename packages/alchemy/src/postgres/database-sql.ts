/**
 * The four statements `Postgres.Database` ever issues, and the quoting each one needs.
 *
 * ⛔ `CREATE DATABASE` TAKES NO BIND PARAMETERS FOR ANY OF ITS VALUES, INCLUDING `OWNER`.
 *   Measured at `gram.y@REL_18_6`: `CreatedbStmt: CREATE DATABASE name opt_with
 *   createdb_opt_list`, and every `createdb_opt_item` value is `NumericOnly`,
 *   `opt_boolean_or_string` or the bare keyword `DEFAULT` — none of those productions reaches
 *   `PARAM` (`$n`). `sql\`…\`` cannot help here; every free-form value in this statement is
 *   escaped by hand, once, in this file, and the assembled text runs through `.unsafe()`.
 * ⚠️ THE DATABASE NAME AND EFFECT'S OWN `sql(value)` IDENTIFIER HELPER DO NOT MIX. `name` is a
 *   `ColId` (`gram.y@REL_18_6` line 17327), a single token — but `Statement.defaultEscape('"')`
 *   (what `sql(value)` compiles to) also rewrites every `.` in the value to `"."`, because it is
 *   built for a *qualified* name like `schema.table`. A database named `"my.app"` would come out
 *   as `"my"."app"` — two tokens where `CreatedbStmt` parses exactly one — a syntax error the
 *   engine would blame on this provider. `quoteIdent` below is the single-token form: it quotes
 *   and doubles embedded `"`, and nothing else.
 * ★ EVERY OTHER `WITH` VALUE (`OWNER`, `TABLESPACE`, `ENCODING`, `LOCALE_PROVIDER`,
 *   `LC_COLLATE`, `LC_CTYPE`) IS A STRING LITERAL, NOT AN IDENTIFIER. Measured at the same tag:
 *   `createdb_opt_item`'s string branch is `opt_boolean_or_string → NonReservedWord_or_Sconst →
 *   NonReservedWord | Sconst`. A locale like `en_US.UTF-8` would hit the same dot-splitting
 *   `quoteIdent` avoids if it were identifier-quoted; a plain `Sconst` (`quoteStringLiteral`) has
 *   no such rule. This rests on `standard_conforming_strings = on` (the PG18 default, and
 *   measured live 2026-09-23 — `docs/postgres.md#measured`); the escaper only ever doubles `'`
 *   and never emits a backslash, so it never depends on which way that setting points.
 */
import type { SqlError } from 'effect/unstable/sql/SqlError';
import * as Effect from 'effect/Effect';
import type { PostgresDatabaseAttributes, PostgresDatabaseProps } from './database-attrs.ts';

/** What every function in this file needs from a client — real (`PgClient.PgClient`) or fake
 * (`fake-sql.ts`). Deliberately smaller than `SqlClient`: nothing here ever needs the tagged
 * template, transactions or streaming, because every statement is either bound params through
 * `.unsafe(text, params)` or a hand-escaped literal through `.unsafe(text)`. */
export interface PgExecutor {
  readonly unsafe: <A extends object>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Effect.Effect<ReadonlyArray<A>, SqlError>;
}

/** Single-token identifier quoting: wrap in `"`, double any embedded `"`. No dot-splitting —
 * see the file header. Used for the database name and, since a role or tablespace name is a
 * `NonReservedWord` too, for `OWNER` and `TABLESPACE`. */
export const quoteIdent = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** SQL string-literal quoting: wrap in `'`, double any embedded `'`. Used for every `WITH`
 * value that is locale or encoding text, never for an identifier (see the file header). */
export const quoteStringLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const withOptions = (props: PostgresDatabaseProps): string => {
  const parts: string[] = [`OWNER ${quoteIdent(props.owner)}`];
  if (props.encoding !== undefined) parts.push(`ENCODING ${quoteStringLiteral(props.encoding)}`);
  if (props.localeProvider !== undefined) {
    parts.push(`LOCALE_PROVIDER ${quoteStringLiteral(props.localeProvider)}`);
  }
  if (props.lcCollate !== undefined)
    parts.push(`LC_COLLATE ${quoteStringLiteral(props.lcCollate)}`);
  if (props.lcCtype !== undefined) parts.push(`LC_CTYPE ${quoteStringLiteral(props.lcCtype)}`);
  if (props.tablespace !== undefined) parts.push(`TABLESPACE ${quoteIdent(props.tablespace)}`);
  if (props.allowConnections !== undefined) {
    parts.push(`ALLOW_CONNECTIONS ${props.allowConnections ? 'true' : 'false'}`);
  }
  if (props.connectionLimit !== undefined) {
    parts.push(`CONNECTION LIMIT ${String(Math.trunc(props.connectionLimit))}`);
  }
  if (props.isTemplate !== undefined)
    parts.push(`IS_TEMPLATE ${props.isTemplate ? 'true' : 'false'}`);
  return parts.join(' ');
};

/**
 * Build the exact `CREATE DATABASE` text — a pure function, unit-tested on its own with no
 * client at all. `CONNECTION LIMIT` and the two booleans are never string-escaped: an integer is
 * `Math.trunc`ed and stringified, and a boolean is one of exactly two literal words this file
 * writes, so no declared value reaches the statement through string interpolation unescaped.
 */
export const buildCreateDatabaseSql = (props: PostgresDatabaseProps): string =>
  `CREATE DATABASE ${quoteIdent(props.name)} WITH ${withOptions(props)}`;

/** `42P04` (`duplicate_database`) is a race: something else created the name between our read
 * and our create. Measured at `internal/sqlError.ts@effect/sql-pg 4.0.0-rc.115`: every SQLSTATE
 * starting `42` — this one included — classifies as `SqlSyntaxError`, the same tag a genuine
 * syntax error would raise; there is no more specific tag to `catchTag` on. So this reads the
 * raw code PostgreSQL sent, carried on `reason.cause.code` (`PgConnection.ts#errorFromFields`,
 * `Object.assign(new Error(...), fields)`), rather than trusting the tag alone. */
export const isDuplicateDatabaseRace = (error: SqlError): boolean => {
  if (error.reason._tag !== 'SqlSyntaxError') return false;
  const cause = error.reason.cause;
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === '42P04'
  );
};

const ROLE_EXISTS_SQL = 'SELECT 1 AS present FROM pg_roles WHERE rolname = $1';

/** `OWNER` is checked against `pg_roles` before any `CREATE`, so a missing role is
 * `PostgresDatabaseOwnerMissing` at reconcile time rather than the server's own
 * `ERROR: role "…" does not exist` surfacing as an unclassified statement failure. */
export const roleExists = (pg: PgExecutor, role: string): Effect.Effect<boolean, SqlError> =>
  Effect.map(
    pg.unsafe<{ readonly present: number }>(ROLE_EXISTS_SQL, [role]),
    (rows) => rows.length > 0,
  );

/** `datlocprovider` is Postgres's internal 1-byte `"char"` type, which this client decodes as
 * raw bytes rather than text (measured 2026-09-23 against the live socket — `docs/postgres.md`);
 * the `CASE` maps it to the same three words `pg_collation.h@REL_18_6#collprovider_name` returns
 * for the same codes, so the row never crosses the wire as anything but ordinary `text`.
 *
 * ⛔ `oid` AND `datconnlimit` ARE READ AT THEIR NATIVE CATALOG WIDTH — NEVER CAST TO `::int8`.
 *   `pg_database.h@REL_18_6` types them `Oid oid` (4 bytes, builtin OID 26) and
 *   `int32 datconnlimit` (4 bytes, builtin OID 23); `@effect/sql-pg`'s codec table
 *   (`PgTypes.ts@4.0.0-rc.115`) decodes both of those as a plain JS `number`
 *   (`readUint32`/`readInt32`), matching `PostgresDatabaseAttributes`'s declared `number`
 *   fields. Casting either to `::int8` changes the WIRE type the server sends, so the same
 *   codec table decodes it as a JS `bigint` instead (`OID.int8`'s codec calls
 *   `DataView.getBigInt64`) — and alchemy's `encodeState`
 *   (`node_modules/alchemy/lib/State/StateEncoding.js`) has no `bigint` branch, so
 *   `JSON.stringify`ing the persisted state throws `TypeError: Do not know how to serialize a
 *   BigInt` on every successful reconcile, and a live `bigint` compared against a declared
 *   `number` in `firstDrift` below is never `===`, so a matching `connectionLimit` reads as
 *   permanent drift. Measured 2026-09-23; regression test:
 *   `database-bigint-serialization.test.ts`. */
const SELECT_DATABASE_SQL = `SELECT
    d.oid AS oid,
    d.datname AS name,
    pg_get_userbyid(d.datdba) AS owner,
    pg_encoding_to_char(d.encoding) AS encoding,
    CASE d.datlocprovider
      WHEN 'b' THEN 'builtin' WHEN 'i' THEN 'icu' WHEN 'c' THEN 'libc'
      ELSE 'libc'
    END AS "localeProvider",
    d.datcollate AS collate,
    d.datctype AS ctype,
    d.datallowconn AS "allowConnections",
    d.datconnlimit AS "connectionLimit",
    d.datistemplate AS "isTemplate",
    t.spcname AS tablespace
  FROM pg_database d
  JOIN pg_tablespace t ON t.oid = d.dattablespace
  WHERE d.datname = $1`;

/** The read: one bound `SELECT` on `pg_database`, joined to the two functions that turn its raw
 * owner and encoding columns into names (`docs/postgres.md#mapping`). `undefined` when the row
 * is absent — ownership branding happens one layer up, in `database.ts`, not here. */
export const selectDatabase = (
  pg: PgExecutor,
  name: string,
): Effect.Effect<PostgresDatabaseAttributes | undefined, SqlError> =>
  Effect.map(pg.unsafe<PostgresDatabaseAttributes>(SELECT_DATABASE_SQL, [name]), (rows) => rows[0]);

/** Compare every declared, asserted prop against the live row. Returns the name of the first
 * prop that drifted, or `undefined` when every declared prop matches. `name` and `owner` are
 * compared by their callers (identity and the create-time assertion), never here. */
export const firstDrift = (
  props: PostgresDatabaseProps,
  live: PostgresDatabaseAttributes,
): { readonly prop: string; readonly declared: unknown; readonly live: unknown } | undefined => {
  const checks: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['encoding', props.encoding, live.encoding],
    ['localeProvider', props.localeProvider, live.localeProvider],
    ['lcCollate', props.lcCollate, live.collate],
    ['lcCtype', props.lcCtype, live.ctype],
    ['allowConnections', props.allowConnections, live.allowConnections],
    ['connectionLimit', props.connectionLimit, live.connectionLimit],
    ['isTemplate', props.isTemplate, live.isTemplate],
    ['tablespace', props.tablespace, live.tablespace],
  ];
  for (const [prop, declared, liveValue] of checks) {
    if (declared !== undefined && declared !== liveValue)
      return { prop, declared, live: liveValue };
  }
  return undefined;
};
