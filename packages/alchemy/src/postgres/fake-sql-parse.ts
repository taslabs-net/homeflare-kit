/**
 * Parsers for exactly the SQL `fake-sql.ts` records — the text this family's builders emit,
 * not SQL in general. A general parser would hide a quoting bug instead of tripping over it.
 */
import type { PostgresDatabaseAttributes } from './database-attrs.ts';
import type { PostgresSchemaAttributes } from './schema-attrs.ts';

const unquoteIdent = (raw: string): string => raw.replace(/""/g, '"');
const unquoteLiteral = (raw: string): string => raw.replace(/''/g, "'");

/** Pull every field back out of exactly the text `buildCreateDatabaseSql` writes. */
export const parseCreate = (text: string): PostgresDatabaseAttributes => {
  const name = /^CREATE DATABASE "((?:[^"]|"")*)" WITH /.exec(text);
  const owner = /OWNER "((?:[^"]|"")*)"/.exec(text);
  const encoding = /ENCODING '((?:[^']|'')*)'/.exec(text);
  const localeProvider = /LOCALE_PROVIDER '((?:[^']|'')*)'/.exec(text);
  const lcCollate = /LC_COLLATE '((?:[^']|'')*)'/.exec(text);
  const lcCtype = /LC_CTYPE '((?:[^']|'')*)'/.exec(text);
  const tablespace = /TABLESPACE "((?:[^"]|"")*)"/.exec(text);
  const allowConnections = /ALLOW_CONNECTIONS (true|false)/.exec(text);
  const connectionLimit = /CONNECTION LIMIT (-?\d+)/.exec(text);
  const isTemplate = /IS_TEMPLATE (true|false)/.exec(text);
  if (name === null || owner === null) {
    throw new Error(`fake-sql: could not parse a generated CREATE DATABASE statement: ${text}`);
  }
  return {
    name: unquoteIdent(name[1] as string),
    oid: 0,
    owner: unquoteIdent(owner[1] as string),
    encoding: encoding === null ? 'UTF8' : unquoteLiteral(encoding[1] as string),
    localeProvider:
      localeProvider === null ? 'libc' : (unquoteLiteral(localeProvider[1] as string) as 'libc'),
    collate: lcCollate === null ? 'C' : unquoteLiteral(lcCollate[1] as string),
    ctype: lcCtype === null ? 'C' : unquoteLiteral(lcCtype[1] as string),
    tablespace: tablespace === null ? 'pg_default' : unquoteIdent(tablespace[1] as string),
    allowConnections: allowConnections === null ? true : allowConnections[1] === 'true',
    connectionLimit: connectionLimit === null ? -1 : Number(connectionLimit[1]),
    isTemplate: isTemplate === null ? false : isTemplate[1] === 'true',
  };
};

/** Parse exactly the text `buildCreateSchemaSql` writes. The caller stamps `database` and
 * `oid`. Absent `AUTHORIZATION`, the owner is `executingRole` — Postgres's own default, the
 * role `current_user` answers. */
export const parseCreateSchema = (
  text: string,
  executingRole: string,
): Omit<PostgresSchemaAttributes, 'database' | 'oid'> => {
  const match =
    /^CREATE SCHEMA IF NOT EXISTS "((?:[^"]|"")*)"(?: AUTHORIZATION "((?:[^"]|"")*)")?$/.exec(text);
  if (match === null) {
    throw new Error(`fake-sql: could not parse a generated CREATE SCHEMA statement: ${text}`);
  }
  return {
    name: unquoteIdent(match[1] as string),
    owner: match[2] === undefined ? executingRole : unquoteIdent(match[2] as string),
    comment: null,
  };
};

/** Parse exactly the text `buildCommentSchemaSql` writes. */
export const parseCommentSchema = (
  text: string,
): { readonly name: string; readonly comment: string } => {
  const match = /^COMMENT ON SCHEMA "((?:[^"]|"")*)" IS '((?:[^']|'')*)'$/.exec(text);
  if (match === null) {
    throw new Error(`fake-sql: could not parse a generated COMMENT ON SCHEMA statement: ${text}`);
  }
  return { name: unquoteIdent(match[1] as string), comment: unquoteLiteral(match[2] as string) };
};

/** Parse exactly the text `buildDropSchemaSql` writes. */
export const parseDropSchema = (
  text: string,
): { readonly name: string; readonly cascade: boolean } => {
  const match = /^DROP SCHEMA IF EXISTS "((?:[^"]|"")*)"( CASCADE)?$/.exec(text);
  if (match === null) {
    throw new Error(`fake-sql: could not parse a generated DROP SCHEMA statement: ${text}`);
  }
  return { name: unquoteIdent(match[1] as string), cascade: match[2] !== undefined };
};
