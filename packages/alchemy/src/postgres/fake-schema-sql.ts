/**
 * The `Postgres.Schema` half of `fake-sql.ts`: the in-memory `pg_namespace` catalog and every
 * statement branch that touches it, split out so each fake file serves one family.
 *
 * ⛔ IT PARSES ITS OWN OUTPUT, NOT SQL IN GENERAL (the rule `fake-sql.ts` documents). Every
 *   parser understands exactly the text `schema-sql.ts` produces. A general SQL parser would
 *   hide a quoting bug instead of tripping over it.
 * ★ Reads answer `current_database()` from this fake's `database` — the same a real server
 *   answers for the connection it opened — and `schemaIsEmpty` from a seeded relation set.
 */
import * as Effect from 'effect/Effect';
import { SqlError, SqlSyntaxError, UnknownError } from 'effect/unstable/sql/SqlError';
import { applyAtomicDrop } from './fake-schema-drop.ts';
import { parseCommentSchema, parseCreateSchema, parseDropSchema } from './fake-sql-parse.ts';
import type { PostgresSchemaAttributes } from './schema-attrs.ts';

/** The schema catalog `fake-sql.ts` constructs and shares with its callers. */
export interface FakeSchemaState {
  readonly schemas: Map<string, PostgresSchemaAttributes>;
  /** Names of schemas this fake pretends hold at least one relation. */
  readonly relationsIn: Set<string>;
  /** Per schema name: how many objects in OTHER schemas depend on it (what the atomic drop's
   * `pg_depend` count answers). Absent means none. */
  readonly dependentsOutside: Map<string, number>;
  /** What `current_database()` answers, and the stamp on every read row. */
  readonly database: string;
  /** What `current_user` answers, and the owner of a `CREATE SCHEMA` without `AUTHORIZATION`. */
  readonly sessionRole: string;
  readonly standardConformingStrings: boolean;
  /** Remaining swallowed `CREATE SCHEMA`s (the S10 lie). */
  swallowRemaining: number;
  /** Owner a raced `CREATE SCHEMA` stores instead, consumed once. */
  raceOwner: string | undefined;
  nextOid(): number;
}

/**
 * Every `Postgres.Schema` statement and the reads that back it. `undefined` when the text
 * belongs to another family, so `fake-sql.ts` can fall through.
 *
 * ⚠️ THE EMPTY CHECK BEFORE THE NAMESPACE READ: `SCHEMA_EMPTY_SQL` contains `FROM pg_namespace`,
 *   so a plain `includes('FROM pg_namespace')` test would swallow it.
 * ⚠️ `current_database()` is `startsWith`, not `includes`: `SELECT_SCHEMA_SQL` also projects
 *   `current_database() AS database`.
 */
export const applySchemaStatement = <A extends object>(
  state: FakeSchemaState,
  text: string,
  params: ReadonlyArray<unknown>,
): Effect.Effect<ReadonlyArray<A>, SqlError> | undefined => {
  // The atomic drop's text contains every marker below; matched first, by its own prefix.
  if (text.startsWith('DO ')) return applyAtomicDrop(state, text);

  if (text.startsWith('SELECT current_database()')) {
    return Effect.succeed([{ database: state.database }] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('SELECT current_user')) {
    return Effect.succeed([{ role: state.sessionRole }] as unknown as ReadonlyArray<A>);
  }

  if (text.includes('AS empty') && text.includes('pg_class')) {
    const name = params[0] as string;
    return Effect.succeed([{ empty: !state.relationsIn.has(name) }] as unknown as ReadonlyArray<A>);
  }

  if (text.includes('FROM pg_catalog.pg_namespace')) {
    const name = params[0] as string;
    const row = state.schemas.get(name);
    return Effect.succeed(
      (row === undefined
        ? []
        : [{ ...row, database: state.database }]) as unknown as ReadonlyArray<A>,
    );
  }

  if (text.startsWith('CREATE SCHEMA')) {
    if (state.swallowRemaining > 0) {
      state.swallowRemaining -= 1;
      return Effect.succeed([] as unknown as ReadonlyArray<A>);
    }
    const parsed = parseCreateSchema(text, state.sessionRole);
    if (state.raceOwner !== undefined) {
      state.schemas.set(parsed.name, {
        ...parsed,
        database: state.database,
        oid: state.nextOid(),
        owner: state.raceOwner,
      });
      state.raceOwner = undefined;
    }
    // PG18 CREATE SCHEMA docs: IF NOT EXISTS does nothing, even if the owner differs.
    if (state.schemas.has(parsed.name)) {
      if (!text.startsWith('CREATE SCHEMA IF NOT EXISTS'))
        return Effect.fail(schemaSqlError('42P06'));
    } else {
      state.schemas.set(parsed.name, { ...parsed, database: state.database, oid: state.nextOid() });
    }
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('COMMENT ON SCHEMA')) {
    const parsed = parseCommentSchema(text, state.standardConformingStrings);
    const existing = state.schemas.get(parsed.name);
    if (existing === undefined) {
      throw new Error(`fake-sql: COMMENT ON SCHEMA on absent schema "${parsed.name}"`);
    }
    state.schemas.set(parsed.name, { ...existing, comment: parsed.comment });
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  if (text.startsWith('DROP SCHEMA')) {
    const parsed = parseDropSchema(text);
    if (!parsed.cascade && state.relationsIn.has(parsed.name))
      return Effect.fail(schemaSqlError('2BP01'));
    if (parsed.cascade) state.relationsIn.delete(parsed.name);
    state.schemas.delete(parsed.name);
    return Effect.succeed([] as unknown as ReadonlyArray<A>);
  }

  return undefined;
};

/** Match the socket/runner SQLSTATE classification, including class 2B as UnknownError. */
const schemaSqlError = (code: string): SqlError => {
  const fields = {
    cause: Object.assign(new Error(code), { code }),
    message: code,
    operation: 'schema DDL',
  };
  return new SqlError({
    reason: code.startsWith('42') ? new SqlSyntaxError(fields) : new UnknownError(fields),
  });
};

/** REL_18_6 pg_namespace.dat: public exists on bootstrap, owned by pg_database_owner. */
export const seedSchemas = (
  rows: readonly PostgresSchemaAttributes[] | undefined,
  database: string,
): Map<string, PostgresSchemaAttributes> =>
  new Map([
    [
      'public',
      {
        name: 'public',
        oid: 2200,
        owner: 'pg_database_owner',
        comment: 'standard public schema',
        database,
      },
    ],
    ...(rows?.map((row) => [row.name, row] as const) ?? []),
  ]);
