/**
 * The read-answering half of the `Postgres.Grants` test fake: the `aclexplode`-shaped
 * queries and the existence/ownership checks, answered from the server model's ACL
 * (`fake-grants-sql.ts`), never from the statement list (S28). Pure row projection — the
 * statement application, the entry model and the grant/revoke semantics live in
 * `fake-grants-sql.ts`. The ACL entry and the model shape are defined HERE so the apply
 * half can import them without a cycle.
 */
import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import type { AclObject } from './fake-grants-parse.ts';

/** One `aclitem` as the fake stores it: one (object, grantee, grantor) with the words that
 * grantor granted, `*`-marked when WITH GRANT OPTION. `words` is mutable: grants and
 * revokes edit it. */
export interface AclEntry {
  readonly object: AclObject;
  readonly grantee: string;
  readonly grantor: string;
  words: string[];
}

/** One relation in the fake's catalog: every relation a table/column statement may name,
 * with its columns, its `relkind` (default `'r'`) and its owner (default: the executor
 * role, which no declared seat role owns). A sequence is a row with `relkind: 'S'`. */
export interface FakeCatalogTable {
  readonly schema: string;
  readonly table: string;
  readonly columns?: ReadonlyArray<string>;
  readonly relkind?: string;
  readonly owner?: string;
}

/** What the read half needs from the factory, keyed per schema so two schemas may hold
 * same-named relations: `relkinds`/`tableOwners` map `"schema\0table"`, `schemaOwners`
 * maps the schema to its owning role. */
export interface FakeGrantsModel {
  readonly schemas: ReadonlySet<string>;
  readonly roles: ReadonlySet<string>;
  readonly databases: ReadonlySet<string>;
  readonly tables: ReadonlyArray<FakeCatalogTable>;
  readonly acl: AclEntry[];
  readonly relkinds: ReadonlyMap<string, string>;
  readonly tableOwners: ReadonlyMap<string, string>;
  readonly schemaOwners: ReadonlyMap<string, string>;
  /** `current_user` — the grantor a write records, and the revoker the column read reports. */
  readonly executor: string;
  /** Whether `current_user` is a superuser: gates the `grantor === owner` arm of the column
   * read's `restorable` (a non-superuser revokes only grants it made, `revoke.sgml`). */
  readonly executorSuper: boolean;
  /** What `SELECT current_database()` answers. */
  readonly connected: string;
}

const aclShapeRow = (marked: string): { privilege: string; grantable: boolean } => ({
  privilege: marked.replace(/\*$/, ''),
  grantable: marked.endsWith('*'),
});

/** Explode the model into aclexplode-shaped rows, filtered to one read's object shape
 * and grantee set. */
const rows = <R>(
  acl: ReadonlyArray<AclEntry>,
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

/** Answer the reads the family issues: the two existence checks, the schema/table/column/
 * default `aclexplode` reads, and the two ownership reads. `undefined` when the text is no
 * read this fake answers — the caller applies it as a write. */
export const answerRead = <A extends object>(
  text: string,
  params: ReadonlyArray<unknown>,
  model: FakeGrantsModel,
): Effect.Effect<ReadonlyArray<A>, SqlError> | undefined => {
  const { acl, schemas, roles, databases, tables } = model;

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
  if (text.startsWith('SELECT 1 AS present FROM pg_database')) {
    return Effect.succeed(
      (databases.has(params[0] as string) ? [{ present: 1 }] : []) as unknown as ReadonlyArray<A>,
    );
  }
  if (text.startsWith('SELECT current_database()')) {
    return Effect.succeed([{ database: model.connected }] as unknown as ReadonlyArray<A>);
  }

  const jsonNames = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      throw new Error(
        `fake-grants-read: existence param must be a JSON string, got ${typeof value}`,
      );
    }
    return JSON.parse(value) as unknown;
  };

  const [schema, role] = [params[0] as string, params[1] as string];
  if (
    text.includes('c.relname AS table') &&
    text.includes('pg_class c') &&
    text.includes('json_array_elements_text') &&
    !text.includes('pg_attribute')
  ) {
    const want = new Set(jsonNames(params[1]) as ReadonlyArray<string>);
    return Effect.succeed(
      tables
        .filter((t) => t.schema === schema && want.has(t.table))
        .map((t) => ({ table: t.table })) as unknown as ReadonlyArray<A>,
    );
  }
  if (text.includes('a.attname AS column') && text.includes('json_array_elements($2::json)')) {
    const pairs = jsonNames(params[1]) as ReadonlyArray<readonly [string, string]>;
    const want = new Set(pairs.map(([table, column]) => `${table}\u0000${column}`));
    return Effect.succeed(
      tables
        .filter((t) => t.schema === schema)
        .flatMap((t) =>
          (t.columns ?? [])
            .filter((c) => want.has(`${t.table}\u0000${c}`))
            .map((c) => ({ table: t.table, column: c })),
        ) as unknown as ReadonlyArray<A>,
    );
  }
  if (text.includes('aclexplode(n.nspacl)')) {
    return Effect.succeed(
      rows(
        acl,
        (o) =>
          o.schema === schema &&
          o.table === undefined &&
          o.column === undefined &&
          o.defaultFor === undefined,
        granteeFilter(role),
        (entry, marked) => ({ public: entry.grantee === 'PUBLIC', ...aclShapeRow(marked) }),
      ) as unknown as ReadonlyArray<A>,
    );
  }
  if (text.includes('aclexplode(c.relacl)')) {
    // The relkind comes back shaped exactly as the query TEXT dictates: the production
    // SQL casts `c.relkind::text` (OID 25, a string); without the cast the `"char"` OID 18
    // column decodes to raw bytes on the socket transport (`PgTypes` has no OID 18 codec),
    // so this fake hands back the same `Uint8Array` the real wire would — one byte per
    // relkind letter — to keep a regression test honest.
    const relkindFor = (object: AclObject): unknown => {
      const relkind = model.relkinds.get(`${object.schema}\u0000${object.table ?? ''}`) ?? 'r';
      if (text.includes('c.relkind::text')) return relkind;
      return new Uint8Array(relkind.split('').map((ch) => ch.charCodeAt(0)));
    };
    return Effect.succeed(
      rows(
        acl,
        (o) =>
          o.schema === schema &&
          o.table !== undefined &&
          o.column === undefined &&
          o.defaultFor === undefined,
        granteeFilter(role),
        (entry, marked) => ({
          table: entry.object.table,
          relkind: relkindFor(entry.object),
          public: entry.grantee === 'PUBLIC',
          ...aclShapeRow(marked),
        }),
      ) as unknown as ReadonlyArray<A>,
    );
  }
  if (text.includes('aclexplode(v.attacl)')) {
    return Effect.succeed(
      rows(
        acl,
        (o) => o.schema === schema && o.column !== undefined,
        granteeFilter(role),
        (entry, marked) => ({
          table: entry.object.table,
          column: entry.object.column,
          public: entry.grantee === 'PUBLIC',
          grantor: entry.grantor,
          owner:
            model.tableOwners.get(`${entry.object.schema}\u0000${entry.object.table ?? ''}`) ??
            model.executor,
          revoker: model.executor,
          revoker_super: model.executorSuper,
          ...aclShapeRow(marked),
        }),
      ) as unknown as ReadonlyArray<A>,
    );
  }
  if (text.includes('aclexplode(d.defaclacl)')) {
    // The defaults read selects ONLY the declared role's words — never PUBLIC's.
    return Effect.succeed(
      rows(
        acl,
        (o) => o.schema === schema && o.defaultFor !== undefined,
        (grantee) => grantee === role,
        (entry, marked) => ({ for_role: entry.object.defaultFor, ...aclShapeRow(marked) }),
      ) as unknown as ReadonlyArray<A>,
    );
  }

  // The ownership reads: `nspowner` answers per schema, `relowner` per relation, all
  // relkinds — from the catalog and the owner maps, never from ACL rows (a fresh owned
  // object carries none).
  if (text.includes('nspowner')) {
    const owns = model.schemaOwners.get(schema) === role;
    return Effect.succeed([{ role_owns: owns }] as unknown as ReadonlyArray<A>);
  }
  if (text.includes('relowner')) {
    const owned = tables
      .filter(
        (t) => t.schema === schema && model.tableOwners.get(`${schema}\u0000${t.table}`) === role,
      )
      .map((t) => ({ table: t.table }));
    return Effect.succeed(owned as unknown as ReadonlyArray<A>);
  }

  return undefined;
};
