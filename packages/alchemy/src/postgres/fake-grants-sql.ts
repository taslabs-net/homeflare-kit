/**
 * The server-model half of the `Postgres.Grants` test fake: an in-memory ACL the way
 * PostgreSQL 18 packs it — one entry per (object, grantee, grantor) pair holding that
 * grantor's granted words — plus the ten statements the parser (`fake-grants-parse.ts`)
 * reduces, applied with the server rules the plan's convergence depends on. The
 * `aclexplode`-shaped reads are answered by `fake-grants-read.ts` from the same model; the
 * grant/revoke semantics (the "revokes as owner" rule included) live in
 * `fake-grants-write.ts`.
 *
 * ★ `REVOKE ALL ON <table>` ALSO clears that grantee's column entries on the table
 *   (measured on PG 18.6 — the plan's convergence proof depends on the model answering
 *   the same), and `REVOKE ALL ON ALL TABLES IN SCHEMA` skips the relkinds the server
 *   skips — a sequence keeps its grants (measured, `grants-plan.ts`).
 * ★ A statement naming a relation or column the catalog does not know fails `42P01` /
 *   `42703`, the way the server refuses a missing object.
 */
import * as Effect from 'effect/Effect';
import { SqlError, SqlSyntaxError } from 'effect/unstable/sql/SqlError';
import type { PgExecutor } from './database-sql.ts';
import { type AclEntry, type FakeCatalogTable, answerRead } from './fake-grants-read.ts';
import { parseGrantStatement } from './fake-grants-parse.ts';
import { grantWords, revoke } from './fake-grants-write.ts';
import { relkindIsPublicRevocable } from './grants-words.ts';

export type { AclEntry, FakeCatalogTable };

export interface RecordedStatement {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface FakeGrants extends PgExecutor {
  readonly statements: ReadonlyArray<RecordedStatement>;
  /** Each `transaction` call, in order — the statement list that committed together. */
  readonly transactions: ReadonlyArray<ReadonlyArray<string>>;
  /** Mutable on purpose: a test seeds a "competing" grant the same way `fake-sql.ts`'s
   * `databases` map is seeded before the reconcile ever runs. */
  readonly acl: AclEntry[];
}

export interface FakeGrantsOptions {
  /** Schemas the existence check (`pg_namespace`) answers yes for. */
  readonly schemas?: ReadonlyArray<string>;
  /** Roles the existence check (`pg_roles`) answers yes for. */
  readonly roles?: ReadonlyArray<string>;
  /** Databases the existence check (`pg_database`) answers yes for. */
  readonly databases?: ReadonlyArray<string>;
  /** The catalog: every relation a table/column statement may name, with its columns,
   * relkind and owner (see `fake-grants-read.ts#FakeCatalogTable`). */
  readonly tables?: ReadonlyArray<FakeCatalogTable>;
  /** The role that owns each seeded schema; unset means the executor owns it. */
  readonly schemaOwner?: string;
  /** Seed grants, each carrying its own grantor (the third-grantor survival cases). */
  readonly acl?: ReadonlyArray<Omit<AclEntry, 'words'> & { readonly words: ReadonlyArray<string> }>;
  /** The role the statements run AS — the grantor recorded on every write, and
   * `current_user` on the column read (default `postgres`, the owner the fixtures assume). */
  readonly executor?: string;
  /** Whether the executor is a superuser (default `true`: `postgres` is). A superuser, the
   * owner itself, or a member of the owning role revokes as the owner — `revoke.sgml`'s rule,
   * modelled by `revokesAsOwner` (fake-grants-read.ts) on both the read and the write. */
  readonly executorSuper?: boolean;
  /** The roles the executor is a member of (recursively): a member of a table's owning role
   * revokes that table's grants as the owner, the same as a superuser. */
  readonly executorMemberships?: ReadonlyArray<string>;
  /** What `current_database()` answers (default `agents`, the declaration the fixtures use). */
  readonly connected?: string;
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

export const makeFakeGrants = (options: FakeGrantsOptions = {}): FakeGrants => {
  const statements: RecordedStatement[] = [];
  const transactions: string[][] = [];
  const schemas = new Set(options.schemas ?? []);
  const roles = new Set(options.roles ?? []);
  const databases = new Set(options.databases ?? []);
  const tables = options.tables ?? [];
  const executor = options.executor ?? 'postgres';
  const executorSuper = options.executorSuper ?? true;
  const executorMemberships = new Set(options.executorMemberships ?? []);
  const connected = options.connected ?? 'agents';
  const acl: AclEntry[] = (options.acl ?? []).map((seed) => ({ ...seed, words: [...seed.words] }));

  // The catalog as pg_class really holds it: relkind and owner per (schema, table), the
  // schema owned by `schemaOwner` or the executor. Default table owner is the schema
  // owner — a CREATE inside a namespace makes its creator the relation's owner too.
  const schemaOwner = options.schemaOwner ?? executor;
  const relkinds = new Map<string, string>();
  const tableOwners = new Map<string, string>();
  for (const t of tables) {
    relkinds.set(`${t.schema}\u0000${t.table}`, t.relkind ?? 'r');
    tableOwners.set(`${t.schema}\u0000${t.table}`, t.owner ?? schemaOwner);
  }
  const schemaOwners = new Map<string, string>();
  for (const schema of schemas) schemaOwners.set(schema, schemaOwner);
  const model = {
    schemas,
    roles,
    databases,
    tables,
    acl,
    relkinds,
    tableOwners,
    schemaOwners,
    executor,
    executorSuper,
    executorMemberships,
    connected,
  };

  const knownTable = (schema: string, table: string) =>
    tables.find((t) => t.schema === schema && t.table === table);

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
    const operation = text.slice(0, 30);
    if (parsed.allTables === true) {
      // `ON ALL TABLES IN SCHEMA` reaches only the revocable relkinds — a sequence keeps
      // its grants (measured on PG 18.6, `grants-plan.ts`).
      for (const table of tables.filter(
        (t) => t.schema === parsed.object.schema && relkindIsPublicRevocable(t.relkind ?? 'r'),
      )) {
        const tableObject = { schema: parsed.object.schema, table: table.table };
        const tableError = revoke(model, tableObject, parsed.grantee, operation);
        if (tableError !== undefined) return Effect.fail(tableError);
        for (const column of table.columns ?? []) {
          const columnError = revoke(model, { ...tableObject, column }, parsed.grantee, operation);
          if (columnError !== undefined) return Effect.fail(columnError);
        }
      }
      return Effect.succeed([]);
    }
    if (parsed.kind === 'grant') {
      grantWords(model, parsed.object, parsed.grantee, parsed.words, parsed.option);
      return Effect.succeed([]);
    }
    const error = revoke(model, parsed.object, parsed.grantee, operation);
    if (error !== undefined) return Effect.fail(error);
    // A table-level `REVOKE ALL` also clears that grantee's column entries on the table
    // (measured on PG 18.6 — a table revoke reaches its columns, unlike `ON ALL TABLES`).
    if (parsed.object.table !== undefined && parsed.object.column === undefined) {
      const known = knownTable(parsed.object.schema, parsed.object.table);
      for (const column of known?.columns ?? []) {
        const columnError = revoke(
          model,
          { schema: parsed.object.schema, table: parsed.object.table, column },
          parsed.grantee,
          operation,
        );
        if (columnError !== undefined) return Effect.fail(columnError);
      }
    }
    return Effect.succeed([]);
  };

  const unsafe = <A extends object>(
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Effect.Effect<ReadonlyArray<A>, SqlError> =>
    Effect.suspend(() => {
      statements.push({ text, params });
      const read = answerRead<A>(text, params, model);
      if (read !== undefined) return read;
      return applyWrite(text) as unknown as Effect.Effect<ReadonlyArray<A>, SqlError>;
    });

  const transaction = (sqls: readonly string[]): Effect.Effect<void, SqlError> =>
    Effect.gen(function* () {
      transactions.push([...sqls]);
      for (const sql of sqls) yield* unsafe(sql).pipe(Effect.asVoid);
    });

  return { unsafe, transaction, statements, transactions, acl };
};
