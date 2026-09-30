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
 * ★ `schemas` mirrors the same rule for `Postgres.Schema`: it parses exactly the text
 *   `buildCreateSchemaSql` / `buildCommentSchemaSql` / `buildDropSchemaSql` (`schema-sql.ts`)
 *   issue, reads `pg_namespace` rows back from its own map (stamped with this fake's
 *   `database`, the same `current_database()` a real server would answer), and answers
 *   `schemaIsEmpty` from a seeded relation set — never from parsing SQL in general.
 */
import * as Effect from 'effect/Effect';
import { SqlError, SqlSyntaxError } from 'effect/unstable/sql/SqlError';
import type { PostgresDatabaseAttributes } from './database-attrs.ts';
import type { PostgresSchemaAttributes } from './schema-attrs.ts';
import type { PgExecutor } from './database-sql.ts';
import {
  parseCommentSchema,
  parseCreate,
  parseCreateSchema,
  parseDropSchema,
} from './fake-sql-parse.ts';

export interface RecordedStatement {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface FakeSql extends PgExecutor {
  readonly statements: ReadonlyArray<RecordedStatement>;
  /** Mutable on purpose: a test seeds a row a "competing" statement would have produced (the
   * `42P04` race case) before the fake ever sees it. */
  readonly databases: Map<string, PostgresDatabaseAttributes>;
  /** Mutable on purpose: a test seeds a live schema (adoption, drift) or clears one (drop). */
  readonly schemas: Map<string, PostgresSchemaAttributes>;
  /** Mutable on purpose: names of schemas this fake pretends hold at least one relation, so a
   * `cascade: false` drop refusal has something to refuse. */
  readonly relationsIn: Set<string>;
}

export interface FakeSqlOptions {
  readonly roles?: ReadonlyArray<string>;
  readonly databases?: ReadonlyArray<PostgresDatabaseAttributes>;
  /** Fail the NEXT `CREATE DATABASE` with SQLSTATE `42P04` (duplicate_database), once, the way a
   * concurrent creator racing this reconcile would — classified exactly as
   * `@effect/sql-pg`'s own driver classifies it (`database-sql.ts`'s header). */
  readonly raceNextCreate?: boolean;
  readonly schemas?: ReadonlyArray<PostgresSchemaAttributes>;
  /** Names of schemas the fake answers `schemaIsEmpty` with `false` for. */
  readonly schemasWithRelations?: ReadonlyArray<string>;
  /** Accept the NEXT `CREATE SCHEMA` (no error) but record nothing — the S10 case where the
   * write's own report is a lie and the immediate re-read finds nothing. */
  readonly swallowNextCreateSchema?: boolean;
  /** What `current_database()` answers and every schema row is stamped with (a real server
   * always reports the database its connection opened). Default `postgres`. */
  readonly database?: string;
  /** The NEXT `CREATE SCHEMA` "succeeds" but stores a row owned by THIS role instead — a
   * concurrent creator won between the first `SELECT` and the `IF NOT EXISTS`, which then
   * does nothing (the re-read row is asserted like any other). Consumed once. */
  readonly raceNextCreateSchema?: string;
  /** What `current_user` answers, and the owner a `CREATE SCHEMA` without `AUTHORIZATION`
   * stores. Default `postgres`. A test that sets this pins the omitted-owner comparison
   * against the session role, not a hardcoded name. */
  readonly currentUser?: string;
}

export const makeFakeSql = (options: FakeSqlOptions = {}): FakeSql => {
  const statements: RecordedStatement[] = [];
  const roles = new Set(options.roles ?? []);
  const databases = new Map(options.databases?.map((d) => [d.name, d] as const) ?? []);
  const schemas = new Map(options.schemas?.map((s) => [s.name, s] as const) ?? []);
  const relationsIn = new Set(options.schemasWithRelations ?? []);
  const database = options.database ?? 'postgres';
  const sessionRole = options.currentUser ?? 'postgres';
  let raceRemaining = options.raceNextCreate === true ? 1 : 0;
  let swallowSchemaRemaining = options.swallowNextCreateSchema === true ? 1 : 0;
  let schemaRaceOwner = options.raceNextCreateSchema;
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

      // ⚠️ startsWith, NOT includes: `SELECT_SCHEMA_SQL` (`schema-sql.ts`) also contains
      //   `current_database() AS database` in its projection; only the standalone check starts
      //   with it.
      if (text.startsWith('SELECT current_database()')) {
        return Effect.succeed([{ database }] as unknown as ReadonlyArray<A>);
      }

      // Starts with `SELECT current_user`, not `current_database`. The omitted-owner
      // comparison reads this; a CREATE without AUTHORIZATION stores the same role.
      if (text.startsWith('SELECT current_user')) {
        return Effect.succeed([{ role: sessionRole }] as unknown as ReadonlyArray<A>);
      }

      if (text.includes('FROM pg_database')) {
        const name = params[0] as string;
        const row = databases.get(name);
        return Effect.succeed((row === undefined ? [] : [row]) as unknown as ReadonlyArray<A>);
      }

      // ⚠️ THE EMPTY CHECK BEFORE THE NAMESPACE READ: `SCHEMA_EMPTY_SQL` itself contains
      //   `FROM pg_namespace` (its subquery resolves the schema's oid), so a plain
      //   `includes('FROM pg_namespace')` test would swallow it — same ordering hazard the
      //   database branch has with `SELECT 1 AS present FROM pg_roles`.
      if (text.includes('AS empty') && text.includes('pg_class')) {
        const name = params[0] as string;
        return Effect.succeed([{ empty: !relationsIn.has(name) }] as unknown as ReadonlyArray<A>);
      }

      if (text.includes('FROM pg_namespace')) {
        const name = params[0] as string;
        const row = schemas.get(name);
        // A real server answers `current_database()` for its own connection; stamp every row
        // with this fake's database so a read row always carries the proof of where it ran.
        return Effect.succeed(
          (row === undefined ? [] : [{ ...row, database }]) as unknown as ReadonlyArray<A>,
        );
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

      if (text.startsWith('CREATE SCHEMA')) {
        if (swallowSchemaRemaining > 0) {
          swallowSchemaRemaining -= 1;
          return Effect.succeed([] as unknown as ReadonlyArray<A>);
        }
        const row = { ...parseCreateSchema(text, sessionRole), database, oid: oidCounter };
        oidCounter += 1;
        if (schemaRaceOwner !== undefined) {
          // A concurrent creator won the race: our IF NOT EXISTS did nothing, their row is
          // what the re-read finds.
          schemas.set(row.name, { ...row, owner: schemaRaceOwner });
          schemaRaceOwner = undefined;
        } else {
          schemas.set(row.name, row);
        }
        return Effect.succeed([] as unknown as ReadonlyArray<A>);
      }

      if (text.startsWith('COMMENT ON SCHEMA')) {
        const parsed = parseCommentSchema(text);
        const existing = schemas.get(parsed.name);
        if (existing === undefined) {
          throw new Error(`fake-sql: COMMENT ON SCHEMA on absent schema "${parsed.name}"`);
        }
        schemas.set(parsed.name, { ...existing, comment: parsed.comment });
        return Effect.succeed([] as unknown as ReadonlyArray<A>);
      }

      if (text.startsWith('DROP SCHEMA')) {
        const parsed = parseDropSchema(text);
        if (parsed.cascade) relationsIn.delete(parsed.name);
        schemas.delete(parsed.name);
        return Effect.succeed([] as unknown as ReadonlyArray<A>);
      }

      throw new Error(`fake-sql: unrecognised statement: ${text}`);
    });

  return { unsafe, statements, databases, schemas, relationsIn };
};
