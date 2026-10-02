/**
 * A recording fake `PgExecutor` (S28: "Tests use `bun:test`… a test never trusts the deploy's
 * own report" — here read back from the fake's own catalog, not from the statement list) for
 * every lifecycle test in this family. No socket, no `@effect/sql-pg` client — it matches the
 * statement shapes this family issues, by text, against an in-memory `pg_database` map. The
 * role catalog is `fake-role-sql.ts`; the schema catalog is `fake-schema-sql.ts`.
 *
 * ⛔ IT PARSES ITS OWN OUTPUT, NOT SQL IN GENERAL. `parseCreate` (`fake-sql-parse.ts`) understands
 *   exactly the text `buildCreateDatabaseSql` produces — quoted with `quoteIdent` /
 *   `quoteStringLiteral` — because that is the only `CREATE DATABASE` this family ever issues. A
 *   general SQL parser would hide a quoting bug instead of tripping over it. The role and schema
 *   halves live in their own files under the same rule.
 */
import * as Effect from 'effect/Effect';
import { SqlError, SqlSyntaxError, UnknownError } from 'effect/unstable/sql/SqlError';
import type { PostgresDatabaseAttributes } from './database-attrs.ts';
import type { PgExecutor } from './database-sql.ts';
import { parseCreate } from './fake-sql-parse.ts';
import { type FakeRoleState, applyRoleStatement } from './fake-role-sql.ts';
import { type FakeSchemaState, applySchemaStatement, seedSchemas } from './fake-schema-sql.ts';
import type { PostgresRoleAttributes } from './role-attrs.ts';
import type { PostgresSchemaAttributes } from './schema-attrs.ts';

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
   * `GRANT`/`REVOKE` mutate it. An empty grantor segment is an inconsistent catalog/test row. */
  readonly memberships: Set<string>;
  /** Options on a membership the name alone hides, keyed `member\0parent\0grantor`. Absent
   * means neither ADMIN, SET nor an explicit per-grant INHERIT. */
  readonly membershipOptions: Map<
    string,
    { readonly admin: boolean; readonly set: boolean; readonly inherit?: boolean }
  >;
  /** Mutable on purpose: a test seeds a live schema (adoption, drift) or clears one (drop). */
  readonly schemas: Map<string, PostgresSchemaAttributes>;
  /** Mutable on purpose: names of schemas this fake pretends hold at least one relation, so a
   * `cascade: false` drop refusal has something to refuse. */
  readonly relationsIn: Set<string>;
}

export interface FakeSqlOptions {
  readonly standardConformingStrings?: boolean;
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
  readonly schemas?: ReadonlyArray<PostgresSchemaAttributes>;
  /** Names of schemas the fake answers `schemaIsEmpty` with `false` for. */
  readonly schemasWithRelations?: ReadonlyArray<string>;
  /** Accept the NEXT `CREATE SCHEMA` (no error) but record nothing — the S10 case where the
   * write's own report is a lie and the immediate re-read finds nothing. */
  readonly swallowNextCreateSchema?: boolean;
  /** What `current_database()` answers and every schema row is stamped with (a real server
   * always reports the database its connection opened). Default `postgres`. */
  readonly database?: string;
  /** The NEXT `CREATE SCHEMA` races with a row owned by THIS role — a
   * concurrent creator won between the first `SELECT` and the `IF NOT EXISTS`, which then
   * does nothing; plain CREATE instead fails with 42P06. Consumed once. */
  readonly raceNextCreateSchema?: string;
  /** What `current_user` answers, and the owner a `CREATE SCHEMA` without `AUTHORIZATION`
   * stores. Default `postgres`. A test that sets this pins the omitted-owner comparison
   * against the session role, not a hardcoded name. */
  readonly currentUser?: string;
}

export const makeFakeSql = (options: FakeSqlOptions = {}): FakeSql => {
  const statements: RecordedStatement[] = [];
  const roleNames = new Set(options.roles ?? []);
  const roleRows = new Map(options.roleRows?.map((r) => [r.name, r] as const) ?? []);
  const databases = new Map(options.databases?.map((d) => [d.name, d] as const) ?? []);
  const memberships = new Set<string>();
  const membershipOptions = new Map<
    string,
    { readonly admin: boolean; readonly set: boolean; readonly inherit?: boolean }
  >();
  const schemas = seedSchemas(options.schemas, options.database ?? 'postgres');
  const relationsIn = new Set(options.schemasWithRelations ?? []);
  let raceRemaining = options.raceNextCreate === true ? 1 : 0;
  let failNext = options.failNext;
  let oidCounter = 20000;
  const nextOid = (): number => {
    const oid = oidCounter;
    oidCounter += 1;
    return oid;
  };
  const roleState: FakeRoleState = {
    roleNames,
    roleRows,
    memberships,
    membershipOptions,
    nextOid,
  };
  const schemaState: FakeSchemaState = {
    schemas,
    relationsIn,
    database: options.database ?? 'postgres',
    standardConformingStrings: options.standardConformingStrings ?? true,
    sessionRole: options.currentUser ?? 'postgres',
    swallowRemaining: options.swallowNextCreateSchema === true ? 1 : 0,
    raceOwner: options.raceNextCreateSchema,
    nextOid,
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

      // ⚠️ startsWith, BEFORE the `FROM pg_database` branch: the full-row select also contains
      //   `FROM pg_database`, but starts with `SELECT d.oid` — only the existence probe starts
      //   with `SELECT 1 AS present`.
      if (text.startsWith('SELECT 1 AS present FROM pg_database')) {
        const name = params[0] as string;
        return Effect.succeed(
          (databases.has(name) ? [{ present: 1 }] : []) as unknown as ReadonlyArray<A>,
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
        const row = { ...parseCreate(text), oid: nextOid() };
        databases.set(row.name, row);
        return Effect.succeed([] as unknown as ReadonlyArray<A>);
      }

      const schemaStatement = applySchemaStatement<A>(schemaState, text, params);
      if (schemaStatement !== undefined) return schemaStatement;

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
    schemas: new Map(schemas),
    relationsIn: new Set(relationsIn),
    swallowRemaining: schemaState.swallowRemaining,
    raceOwner: schemaState.raceOwner,
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
    schemas.clear();
    for (const [key, value] of snap.schemas) schemas.set(key, value);
    relationsIn.clear();
    for (const name of snap.relationsIn) relationsIn.add(name);
    schemaState.swallowRemaining = snap.swallowRemaining;
    schemaState.raceOwner = snap.raceOwner;
    oidCounter = snap.oid;
  };
  const transaction = (sqls: readonly string[]): Effect.Effect<void, SqlError> => {
    const snap = snapshot();
    return Effect.gen(function* () {
      for (const sql of sqls) yield* unsafe(sql).pipe(Effect.asVoid);
    }).pipe(Effect.onError(() => Effect.sync(() => restore(snap))));
  };

  return {
    unsafe,
    transaction,
    statements,
    databases,
    roleRows,
    memberships,
    membershipOptions,
    schemas,
    relationsIn,
  };
};
