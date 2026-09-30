/**
 * The server-model half of the `Postgres.Grants` test fake: an in-memory ACL the way
 * PostgreSQL 18 packs it — one entry per (object, grantee, grantor) pair holding that
 * grantor's granted words — plus the ten statements the parser (`fake-grants-parse.ts`)
 * reduces, applied with the server rules the plan's convergence depends on. Every READ the
 * family issues (the `aclexplode` queries and the existence checks) is answered from the
 * model, never from the statement list (S28).
 *
 * ★ `GRANT` upgrades a base word to its `*` (WITH GRANT OPTION) form rather than keeping
 *   both — one `aclitem` per pair, the way the server packs it.
 * ★ `REVOKE ALL` removes only the executing role's own grants: a third grantor's grant to
 *   the same grantee SURVIVES silently, which is exactly the survival
 *   `PostgresGrantsRepairRefused` exists to surface; a revoke whose grantee re-granted
 *   onward fails like the server does without CASCADE (`2BP01`).
 * ★ A statement naming a relation or column the catalog does not know fails `42P01` /
 *   `42703`, the way the server refuses a missing object.
 */
import * as Effect from 'effect/Effect';
import { SqlError, SqlSyntaxError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import { type AclObject, parseGrantStatement } from './fake-grants-parse.ts';

/** One `aclitem` as the fake stores it: one (object, grantee, grantor) with the words that
 * grantor granted, `*`-marked when WITH GRANT OPTION. `words` is mutable: grants and
 * revokes edit it. */
export interface AclEntry {
  readonly object: AclObject;
  readonly grantee: string;
  readonly grantor: string;
  words: string[];
}

export interface RecordedStatement {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface FakeGrants extends PgExecutor {
  readonly statements: ReadonlyArray<RecordedStatement>;
  /** Mutable on purpose: a test seeds a "competing" grant the same way `fake-sql.ts`'s
   * `databases` map is seeded before the reconcile ever runs. */
  readonly acl: AclEntry[];
}

export interface FakeGrantsOptions {
  /** Schemas the existence check (`pg_namespace`) answers yes for. */
  readonly schemas?: ReadonlyArray<string>;
  /** Roles the existence check (`pg_roles`) answers yes for. */
  readonly roles?: ReadonlyArray<string>;
  /** The catalog: every relation a table/column statement may name, with its columns. */
  readonly tables?: ReadonlyArray<{
    readonly schema: string;
    readonly table: string;
    readonly columns?: ReadonlyArray<string>;
  }>;
  /** Seed grants, each carrying its own grantor (the third-grantor survival cases). */
  readonly acl?: ReadonlyArray<Omit<AclEntry, 'words'> & { readonly words: ReadonlyArray<string> }>;
  /** The role the statements run AS — the grantor recorded on every write (default
   * `postgres`, the owner the fixtures assume). */
  readonly executor?: string;
}

const failSql = (code: string, message: string, operation: string) =>
  Effect.fail(
    new SqlError({
      reason: new SqlSyntaxError({
        cause: Object.assign(new Error(message), { code }),
        message,
        operation,
      }),
    }),
  );

const sameObject = (a: AclObject, b: AclObject): boolean =>
  a.schema === b.schema &&
  a.table === b.table &&
  a.column === b.column &&
  a.defaultFor === b.defaultFor;

export const makeFakeGrants = (options: FakeGrantsOptions = {}): FakeGrants => {
  const statements: RecordedStatement[] = [];
  const schemas = new Set(options.schemas ?? []);
  const roles = new Set(options.roles ?? []);
  const tables = options.tables ?? [];
  const executor = options.executor ?? 'postgres';
  const acl: AclEntry[] = (options.acl ?? []).map((seed) => ({ ...seed, words: [...seed.words] }));

  const knownTable = (schema: string, table: string) =>
    tables.find((t) => t.schema === schema && t.table === table);

  /** Add words to the (object, grantee, executor) entry, upgrading a base word to its `*`
   * form rather than keeping both. */
  const grantWords = (
    object: AclObject,
    grantee: string,
    words: ReadonlyArray<string>,
    option: boolean,
  ): void => {
    let entry = acl.find(
      (e) => sameObject(e.object, object) && e.grantee === grantee && e.grantor === executor,
    );
    if (entry === undefined) {
      entry = { object, grantee, grantor: executor, words: [] };
      acl.push(entry);
    }
    for (const word of words) {
      const base = word.replace(/\*$/, '');
      entry.words = entry.words.filter((w) => w.replace(/\*$/, '') !== base);
      entry.words.push(option ? `${word}*` : word);
    }
  };

  /** Remove the executing role's own grants for (object, grantee); a third grantor's entry
   * survives by the keying, and a grantee that re-granted onward fails without CASCADE. */
  const revoke = (object: AclObject, grantee: string, operation: string): SqlError | undefined => {
    const own = acl.filter(
      (e) => sameObject(e.object, object) && e.grantee === grantee && e.grantor === executor,
    );
    if (own.length > 0 && acl.some((e) => sameObject(e.object, object) && e.grantor === grantee)) {
      return new SqlError({
        reason: new SqlSyntaxError({
          cause: Object.assign(new Error('dependent privileges exist'), { code: '2BP01' }),
          message: 'dependent privileges exist',
          operation,
        }),
      });
    }
    for (const entry of own) acl.splice(acl.indexOf(entry), 1);
    return undefined;
  };

  /** Explode the model into aclexplode-shaped rows, filtered to one read's object shape
   * and grantee set. */
  const rows = <R>(
    pickObject: (object: AclObject) => boolean,
    pickGrantee: (grantee: string) => boolean,
    shape: (entry: AclEntry, word: string) => R,
  ): R[] => {
    const out: R[] = [];
    for (const entry of acl) {
      if (!pickObject(entry.object) || !pickGrantee(entry.grantee)) continue;
      for (const word of entry.words) out.push(shape(entry, word));
    }
    return out;
  };

  const granteeFilter =
    (role: string) =>
    (grantee: string): boolean =>
      grantee === role || grantee === 'PUBLIC';
  const word = (marked: string) => ({
    privilege: marked.replace(/\*$/, ''),
    grantable: marked.endsWith('*'),
  });

  /** Apply one parsed write, validating its target against the catalog first. */
  const applyWrite = (text: string): Effect.Effect<ReadonlyArray<never>, SqlError> => {
    const parsed = parseGrantStatement(text);
    if (parsed === undefined) {
      throw new Error(`fake-grants-sql: unrecognised statement: ${text}`);
    }
    if (parsed.object.table !== undefined) {
      const known = knownTable(parsed.object.schema, parsed.object.table);
      if (known === undefined) {
        return failSql(
          '42P01',
          `relation "${parsed.object.table}" does not exist`,
          text.slice(0, 30),
        );
      }
      if (
        parsed.object.column !== undefined &&
        !(known.columns ?? []).includes(parsed.object.column)
      ) {
        return failSql(
          '42703',
          `column "${parsed.object.column}" does not exist`,
          text.slice(0, 30),
        );
      }
    }
    if (parsed.allTables === true) {
      for (const table of tables.filter((t) => t.schema === parsed.object.schema)) {
        const tableObject = { schema: parsed.object.schema, table: table.table };
        const tableError = revoke(tableObject, parsed.grantee, text.slice(0, 30));
        if (tableError !== undefined) return Effect.fail(tableError);
        for (const column of table.columns ?? []) {
          const columnError = revoke({ ...tableObject, column }, parsed.grantee, text.slice(0, 30));
          if (columnError !== undefined) return Effect.fail(columnError);
        }
      }
      return Effect.succeed([]);
    }
    if (parsed.kind === 'grant') {
      grantWords(parsed.object, parsed.grantee, parsed.words, parsed.option);
      return Effect.succeed([]);
    }
    const error = revoke(parsed.object, parsed.grantee, text.slice(0, 30));
    return error === undefined ? Effect.succeed([]) : Effect.fail(error);
  };

  const unsafe = <A extends object>(
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Effect.Effect<ReadonlyArray<A>, SqlError> =>
    Effect.suspend(() => {
      statements.push({ text, params });

      if (text.startsWith('SELECT 1 AS present FROM pg_roles')) {
        return Effect.succeed(
          (roles.has(params[0] as string) ? [{ present: 1 }] : []) as unknown as ReadonlyArray<A>,
        );
      }
      if (text.startsWith('SELECT 1 AS present FROM pg_namespace')) {
        return Effect.succeed(
          (schemas.has(params[0] as string) ? [{ present: 1 }] : []) as unknown as ReadonlyArray<A>,
        );
      }
      const [schema, role] = [params[0] as string, params[1] as string];
      if (text.includes('aclexplode(n.nspacl)')) {
        return Effect.succeed(
          rows(
            (o) =>
              o.schema === schema &&
              o.table === undefined &&
              o.column === undefined &&
              o.defaultFor === undefined,
            granteeFilter(role),
            (entry, marked) => ({ public: entry.grantee === 'PUBLIC', ...word(marked) }),
          ) as unknown as ReadonlyArray<A>,
        );
      }
      if (text.includes('aclexplode(c.relacl)')) {
        return Effect.succeed(
          rows(
            (o) =>
              o.schema === schema &&
              o.table !== undefined &&
              o.column === undefined &&
              o.defaultFor === undefined,
            granteeFilter(role),
            (entry, marked) => ({
              table: entry.object.table,
              public: entry.grantee === 'PUBLIC',
              ...word(marked),
            }),
          ) as unknown as ReadonlyArray<A>,
        );
      }
      if (text.includes('aclexplode(v.attacl)')) {
        return Effect.succeed(
          rows(
            (o) => o.schema === schema && o.column !== undefined,
            granteeFilter(role),
            (entry, marked) => ({
              table: entry.object.table,
              column: entry.object.column,
              public: entry.grantee === 'PUBLIC',
              ...word(marked),
            }),
          ) as unknown as ReadonlyArray<A>,
        );
      }
      if (text.includes('aclexplode(d.defaclacl)')) {
        // The defaults read selects ONLY the declared role's words — never PUBLIC's.
        return Effect.succeed(
          rows(
            (o) => o.schema === schema && o.defaultFor !== undefined,
            (grantee) => grantee === role,
            (entry, marked) => ({ for_role: entry.object.defaultFor, ...word(marked) }),
          ) as unknown as ReadonlyArray<A>,
        );
      }
      return applyWrite(text) as unknown as Effect.Effect<ReadonlyArray<A>, SqlError>;
    });

  return { unsafe, statements, acl };
};
