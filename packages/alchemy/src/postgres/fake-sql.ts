/**
 * A recording fake `PgExecutor` (S28: "Tests use `bun:test`… a test never trusts the deploy's
 * own report" — here read back from the fake's own catalog, not from the statement list) for
 * every lifecycle test in this family. No socket, no `@effect/sql-pg` client — it is small
 * enough to re-derive the one thing this provider ever asks of a real one: the statement shapes
 * this family issues, matched by text, against an in-memory `pg_database` map and the role
 * catalog `fake-role-sql.ts` applies.
 *
 * ⛔ IT PARSES ITS OWN OUTPUT, NOT SQL IN GENERAL. `parseCreate` below understands exactly the
 *   text `buildCreateDatabaseSql` (`database-sql.ts`) produces — quoted with `quoteIdent` /
 *   `quoteStringLiteral` — because that is the only `CREATE DATABASE` this family ever issues. A
 *   general SQL parser would hide a quoting bug instead of tripping over it. The role half lives
 *   in `fake-role-sql.ts` under the same rule.
 */
import * as Effect from 'effect/Effect';
import { SqlError, SqlSyntaxError, UnknownError } from 'effect/unstable/sql/SqlError';
import type { PostgresDatabaseAttributes } from './database-attrs.ts';
import type { PostgresRoleAttributes } from './role-attrs.ts';
import type { PgExecutor } from './database-sql.ts';
import { unquoteIdent, unquoteLiteral } from './fake-sql-quote.ts';
import { type FakeRoleState, applyRoleStatement } from './fake-role-sql.ts';

export interface RecordedStatement {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface FakeSql extends PgExecutor {
  readonly statements: ReadonlyArray<RecordedStatement>;
  /** Mutable on purpose: a test seeds a row a "competing" statement would have produced (the
   * `42P04` race case) before the fake ever sees it. */
  readonly databases: Map<string, PostgresDatabaseAttributes>;
  /** Mutable on purpose: a test seeds a live role (adoption, drift) or clears one (drop). */
  readonly roleRows: Map<string, PostgresRoleAttributes>;
  /** `member\0parent\0grantor` triples backing `pg_auth_members` (a plain `pg_auth_members`
   * read, a grant, a revoke and a DROP ROLE cascade all go through `fake-role-sql.ts`);
   * `GRANT`/`REVOKE` mutate it. An empty grantor segment is a grantor role that no longer
   * exists. */
  readonly memberships: Set<string>;
  /** Options on a membership the name alone hides, keyed `member\0parent\0grantor`. Absent
   * means neither ADMIN nor SET. */
  readonly membershipOptions: Map<string, { readonly admin: boolean; readonly set: boolean }>;
}

export interface FakeSqlOptions {
  readonly roles?: ReadonlyArray<string>;
  readonly databases?: ReadonlyArray<PostgresDatabaseAttributes>;
  readonly roleRows?: ReadonlyArray<PostgresRoleAttributes>;
  /** Fail the NEXT `CREATE DATABASE` with SQLSTATE `42P04` (duplicate_database), once, the way a
   * concurrent creator racing this reconcile would — classified exactly as
   * `@effect/sql-pg`'s own driver classifies it (`database-sql.ts`'s header). */
  readonly raceNextCreate?: boolean;
  /** Fail the next statement whose text starts with this prefix, once, without applying it.
   * A `transaction` that included earlier statements rolls them back. */
  readonly failNext?: string;
}

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
  const roleNames = new Set(options.roles ?? []);
  const roleRows = new Map(options.roleRows?.map((r) => [r.name, r] as const) ?? []);
  const databases = new Map(options.databases?.map((d) => [d.name, d] as const) ?? []);
  const memberships = new Set<string>();
  const membershipOptions = new Map<string, { readonly admin: boolean; readonly set: boolean }>();
  let raceRemaining = options.raceNextCreate === true ? 1 : 0;
  let failNext = options.failNext;
  let oidCounter = 20000;
  const roleState: FakeRoleState = {
    roleNames,
    roleRows,
    memberships,
    membershipOptions,
    nextOid: () => {
      const oid = oidCounter;
      oidCounter += 1;
      return oid;
    },
  };

  const unsafe = <A extends object>(
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Effect.Effect<ReadonlyArray<A>, SqlError> =>
    Effect.suspend(() => {
      statements.push({ text, params });

      if (failNext !== undefined && text.startsWith(failNext)) {
        failNext = undefined;
        return Effect.fail(
          new SqlError({
            reason: new UnknownError({
              cause: new Error('injected statement failure'),
              message: 'injected statement failure',
              operation: text.slice(0, 40),
            }),
          }),
        );
      }

      if (text.startsWith('SELECT 1 AS present FROM pg_roles')) {
        const role = params[0] as string;
        return Effect.succeed(
          (roleNames.has(role) || roleRows.has(role)
            ? [{ present: 1 }]
            : []) as unknown as ReadonlyArray<A>,
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
        const row = { ...parseCreate(text), oid: roleState.nextOid() };
        databases.set(row.name, row);
        return Effect.succeed([] as unknown as ReadonlyArray<A>);
      }

      const roleStatement = applyRoleStatement<A>(roleState, text, params);
      if (roleStatement !== undefined) return roleStatement;

      throw new Error(`fake-sql: unrecognised statement: ${text}`);
    });

  const snapshot = () => ({
    roleRows: new Map(roleRows),
    roleNames: new Set(roleNames),
    memberships: new Set(memberships),
    membershipOptions: new Map(membershipOptions),
    databases: new Map(databases),
    oid: oidCounter,
  });
  const restore = (snap: ReturnType<typeof snapshot>) => {
    roleRows.clear();
    for (const [key, value] of snap.roleRows) roleRows.set(key, value);
    roleNames.clear();
    for (const name of snap.roleNames) roleNames.add(name);
    memberships.clear();
    for (const key of snap.memberships) memberships.add(key);
    membershipOptions.clear();
    for (const [key, value] of snap.membershipOptions) membershipOptions.set(key, value);
    databases.clear();
    for (const [key, value] of snap.databases) databases.set(key, value);
    oidCounter = snap.oid;
  };
  const transaction = (sqls: readonly string[]): Effect.Effect<void, SqlError> => {
    const snap = snapshot();
    return Effect.gen(function* () {
      for (const sql of sqls) yield* unsafe(sql).pipe(Effect.asVoid);
    }).pipe(Effect.onError(() => Effect.sync(() => restore(snap))));
  };

  return { unsafe, transaction, statements, databases, roleRows, memberships, membershipOptions };
};
