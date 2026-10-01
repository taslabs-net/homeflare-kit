/**
 * The `Postgres.Schema` socket transport, mocked at the pool: what the review measured was a
 * cold plan's `read` opening the declared database directly and failing untyped
 * (`UnknownError`, SQLSTATE `3D000` — the pinned driver classification below). The handler
 * now probes `pg_database` over the FAMILY pool first and treats a missing declared database
 * as schema-absence, and the operation's pool opens the declared database through the
 * `withPg` override — the config each `PgClient.layer` call receives is recorded here.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import * as PgClientModule from '@effect/sql-pg/PgClient';
import type { PgClient as PgClientService } from '@effect/sql-pg/PgClient';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { SqlClient } from 'effect/unstable/sql/SqlClient';
import { isDependentObjectsError } from './schema-sql.ts';
import { classifyInstalled } from './installed-classifier.ts';
import { PostgresPool, postgresConnection } from './connection.ts';
import { postgresSchemaHandlers } from './schema.ts';
import { PostgresSchemaDeleteForeignRefused } from './schema-errors.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { type RouteAnswers, deleteArgs, readArgs, route } from './schema-test-kit.ts';
import { Unowned } from 'alchemy/AdoptPolicy';

if (postgresSchemaHandlers.read === undefined) {
  throw new Error('Postgres.Schema is missing its read handler');
}
/** Narrowed once at module scope — the narrowing does not survive into `test` callbacks. */
const schemaRead = postgresSchemaHandlers.read;

/** Every `PgClient.layer` config the mocked layer was built with — one per `withPg` call. */
const pools: Array<{ database?: string | undefined }> = [];
/** Every SQL text the fake client ran, in order. */
const queries: string[] = [];
/** The router answers for the current test (`schema-test-kit.ts` markers, JSON strings). */
let answers: RouteAnswers = {};

// The fake service: `unsafe` is the only member the schema handlers call (`withPg`'s build
// callbacks), and `Statement<A>` is an `Effect<ReadonlyArray<A>, SqlError>` — a plain succeed
// satisfies the same call shape.
const fakeClient = {
  unsafe: (text: string) => {
    queries.push(text);
    const answer = route(text, answers);
    return Effect.succeed(
      (answer === undefined ? [] : (JSON.parse(answer) as ReadonlyArray<object>)) as never,
    );
  },
} as unknown as PgClientService;

// The pool factory is provided to this Effect only; other suites keep the real driver.
const socket = Layer.merge(
  // tmp-allow: unix socket directory the driver joins a socket name onto, not a directory this test creates
  postgresConnection({ host: '/tmp', database: 'postgres', username: 'postgres' }),
  Layer.succeed(PostgresPool, (config) => {
    pools.push(config);
    return Layer.merge(
      Layer.succeed(PgClientModule.PgClient, fakeClient),
      Layer.succeed(SqlClient, fakeClient),
    );
  }),
);
const declared: PostgresSchemaProps = { name: 's4', database: 'agents', owner: 'seat_role' };
const persisted: PostgresSchemaAttributes = {
  name: 's4',
  database: 'agents',
  oid: 16442,
  owner: 'seat_role',
  comment: null,
};

describe('socket transport: a missing declared database is schema absent', () => {
  beforeEach(() => {
    pools.length = 0;
    queries.length = 0;
    answers = {};
  });

  test('delete is idempotent success: one probe over the FAMILY pool, no connection to the declared database', async () => {
    answers = { probe: '[]' };
    await Effect.runPromise(
      postgresSchemaHandlers
        .delete(deleteArgs({ ...declared, cascade: true }, persisted))
        .pipe(Effect.provide(socket)),
    );
    expect(pools.length).toBe(1);
    expect(pools[0]?.database).toBe('postgres');
    expect(queries.length).toBe(1);
    expect(queries[0]).toContain('FROM pg_database');
    expect(queries.some((q) => q.startsWith('DROP SCHEMA'))).toBe(false);
  });

  test('read answers absent: the untyped 3D000 connect never happens', async () => {
    answers = { probe: '[]' };
    const result = await Effect.runPromise(
      schemaRead(readArgs(declared)).pipe(Effect.provide(socket)),
    );
    expect(result).toBeUndefined();
    expect(pools.length).toBe(1);
    expect(pools[0]?.database).toBe('postgres');
    expect(queries.length).toBe(1);
    expect(queries[0]).toContain('FROM pg_database');
  });

  test('the `database` override reaches the pool: probe over the family pool, statements over the declared one', async () => {
    answers = {
      probe: '[{"present":1}]',
      schema: '[{"name":"s4","oid":16442,"owner":"seat_role","comment":null,"database":"agents"}]',
      empty: '[{"empty":true}]',
      proof: '[{"database":"agents"}]',
    };
    await Effect.runPromise(
      postgresSchemaHandlers.delete(deleteArgs(declared, persisted)).pipe(Effect.provide(socket)),
    );
    // The probe opened the family database; every statement after it opened `agents`.
    expect(pools.map((pool) => pool.database)).toEqual(['postgres', 'agents']);
    expect(queries.some((q) => q.startsWith('DROP SCHEMA'))).toBe(true);
  });

  test('read over an existing declared database answers the row from the overridden pool', async () => {
    answers = {
      probe: '[{"present":1}]',
      schema: '[{"name":"s4","oid":16442,"owner":"seat_role","comment":null,"database":"agents"}]',
      proof: '[{"database":"agents"}]',
    };
    const result = await Effect.runPromise(
      schemaRead(readArgs(declared)).pipe(Effect.provide(socket)),
    );
    expect(pools.map((pool) => pool.database)).toEqual(['postgres', 'agents']);
    expect(Unowned.is(result)).toBe(true);
    expect({ ...(result as object) }).toEqual({ ...persisted });
  });

  test('delete still proves ownership over the socket: an out-of-band recreation is refused', async () => {
    // The re-read row is another role's (the review's s4 scenario): the persisted proof cannot
    // vouch for it, and the socket pool never issues the DROP.
    answers = {
      probe: '[{"present":1}]',
      schema: '[{"name":"s4","oid":16443,"owner":"other_role","comment":null,"database":"agents"}]',
      proof: '[{"database":"agents"}]',
    };
    const error = await Effect.runPromise(
      Effect.flip(
        postgresSchemaHandlers
          .delete(deleteArgs({ ...declared, cascade: true }, persisted))
          .pipe(Effect.provide(socket)),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDeleteForeignRefused);
    expect(error).toMatchObject({ liveOid: 16443, liveOwner: 'other_role', lastOid: 16442 });
    expect(queries.some((q) => q.startsWith('DROP SCHEMA'))).toBe(false);
  });

  test('the installed classifier keeps 3D000 as UnknownError with the raw code — the untyped failure the probe prevents', async () => {
    // `classifySqlState` only types class `42` as `SqlSyntaxError`; `3D000` (`invalid_catalog_name`)
    // is class `3D`, so a socket connect to a missing database surfaces as this shape today —
    // the reason `read`/`delete` probe `pg_database` first instead of opening it.
    const error = await classifyInstalled('3D000', 'database "agents" does not exist');
    expect(error.reason._tag).toBe('UnknownError');
    expect((error.reason as { cause?: { code?: string } }).cause?.code).toBe('3D000');
    expect(isDependentObjectsError(error)).toBe(false);
  });
});
