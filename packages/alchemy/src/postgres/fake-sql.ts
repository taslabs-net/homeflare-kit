/**
 * A recording fake `PgExecutor` (S28: "Tests use `bun:test`… a test never trusts the deploy's
 * own report" — here read back from the fake's own catalog, not from the statement list) for
 * every lifecycle test in this family. No socket, no `@effect/sql-pg` client — it is small
 * enough to re-derive the one thing this provider ever asks of a real one: three statement
 * shapes, matched by text, against an in-memory `pg_roles` set and `pg_database` map.
 *
 * ⛔ IT PARSES ITS OWN OUTPUT, NOT SQL IN GENERAL. `parseCreate` below understands exactly the
 *   text `buildCreateDatabaseSql` (`database-sql.ts`) produces — quoted with `quoteIdent` /
 *   `quoteStringLiteral` — because that is the only `CREATE DATABASE` this family ever issues. A
 *   general SQL parser would hide a quoting bug instead of tripping over it.
 */
import * as Effect from 'effect/Effect';
import { SqlError, SqlSyntaxError } from 'effect/unstable/sql/SqlError';
import type { PostgresDatabaseAttributes } from './database-attrs.ts';
import type { PgExecutor } from './database-sql.ts';

export interface RecordedStatement {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface FakeSql extends PgExecutor {
  readonly statements: ReadonlyArray<RecordedStatement>;
  /** Mutable on purpose: a test seeds a row a "competing" statement would have produced (the
   * `42P04` race case) before the fake ever sees it. */
  readonly databases: Map<string, PostgresDatabaseAttributes>;
}

export interface FakeSqlOptions {
  readonly roles?: ReadonlyArray<string>;
  readonly databases?: ReadonlyArray<PostgresDatabaseAttributes>;
  /** Fail the NEXT `CREATE DATABASE` with SQLSTATE `42P04` (duplicate_database), once, the way a
   * concurrent creator racing this reconcile would — classified exactly as
   * `@effect/sql-pg`'s own driver classifies it (`database-sql.ts`'s header). */
  readonly raceNextCreate?: boolean;
}

const unquoteIdent = (raw: string): string => raw.replace(/""/g, '"');
const unquoteLiteral = (raw: string): string => raw.replace(/''/g, "'");

/** Pull every field back out of exactly the text `buildCreateDatabaseSql` writes. */
const parseCreate = (text: string): PostgresDatabaseAttributes => {
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

export const makeFakeSql = (options: FakeSqlOptions = {}): FakeSql => {
  const statements: RecordedStatement[] = [];
  const roles = new Set(options.roles ?? []);
  const databases = new Map(options.databases?.map((d) => [d.name, d] as const) ?? []);
  let raceRemaining = options.raceNextCreate === true ? 1 : 0;
  let oidCounter = 20000;

  const unsafe = <A extends object>(
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Effect.Effect<ReadonlyArray<A>, SqlError> =>
    Effect.suspend(() => {
      statements.push({ text, params });

      if (text.startsWith('SELECT 1 AS present FROM pg_roles')) {
        const role = params[0] as string;
        return Effect.succeed(
          (roles.has(role) ? [{ present: 1 }] : []) as unknown as ReadonlyArray<A>,
        );
      }

      if (text.includes('FROM pg_database')) {
        const name = params[0] as string;
        const row = databases.get(name);
        return Effect.succeed((row === undefined ? [] : [row]) as unknown as ReadonlyArray<A>);
      }

      if (text.startsWith('CREATE DATABASE')) {
        if (raceRemaining > 0) {
          raceRemaining -= 1;
          return Effect.fail(
            new SqlError({
              reason: new SqlSyntaxError({
                cause: Object.assign(new Error('database "x" already exists'), { code: '42P04' }),
                message: 'duplicate_database (fake race)',
                operation: 'CREATE DATABASE',
              }),
            }),
          );
        }
        const row = { ...parseCreate(text), oid: oidCounter };
        oidCounter += 1;
        databases.set(row.name, row);
        return Effect.succeed([] as unknown as ReadonlyArray<A>);
      }

      throw new Error(`fake-sql: unrecognised statement: ${text}`);
    });

  return { unsafe, statements, databases };
};
