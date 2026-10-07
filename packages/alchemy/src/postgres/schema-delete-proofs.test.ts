/**
 * The red-team-proven delete and read contracts of `Postgres.Schema` (PR #334, 2026-09-30),
 * over the runner transport — the exact scenarios the Opus review measured live.
 *
 * 1. DELETE DROPS ONLY WHAT IT CAN PROVE IT CREATED. The engine does not re-read before a
 *    delete that has state (alchemy `Apply.ts`), so a schema dropped and recreated out of
 *    band under the same name — another role's, with its own objects — was dropped by NAME,
 *    `CASCADE` included. The handler now re-reads first: absent is idempotent success, and a
 *    live row whose `oid` or `owner` no longer matches the persisted proof is a typed
 *    `PostgresSchemaDeleteForeignRefused`, never a `DROP`.
 * 2. A MISSING DECLARED DATABASE IS "SCHEMA ABSENT". A cold plan's `read` used to open the
 *    declared database directly and fail untyped (`ConnectionError` over psql, `UnknownError`
 *    3D000 over the socket); now both `read` and `delete` probe `pg_database` over the FAMILY
 *    connection first and treat absence as schema-absence — the delete stays idempotent.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makePsqlExecutor } from './psql-executor.ts';
import { postgresRunnerConnection } from './connection.ts';
import { deleteWithClient, postgresSchemaHandlers } from './schema.ts';
import { PostgresSchemaDeleteForeignRefused } from './schema-errors.ts';
import type { PostgresSchemaAttributes, PostgresSchemaProps } from './schema-attrs.ts';
import { deleteArgs, readArgs, route, router, runnerWith } from './schema-test-kit.ts';

if (postgresSchemaHandlers.read === undefined) {
  throw new Error('Postgres.Schema is missing its read handler');
}
/** Narrowed once at module scope — the narrowing does not survive into `test` callbacks. */
const schemaRead = postgresSchemaHandlers.read;

/** The out-of-band recreation scenario the review measured: created by `seat_role` (oid 16442),
 * dropped and recreated by `other_role` with a table and a row (oid 16443). */
const declared: PostgresSchemaProps = {
  name: 's4',
  database: 'agents',
  owner: 'seat_role',
};
const persisted: PostgresSchemaAttributes = {
  name: 's4',
  database: 'agents',
  oid: 16442,
  owner: 'seat_role',
  comment: null,
};
/** `oid` crosses the runner as a JSON string; the executor normalizes it to a number. */
const schemaRow = (oid: number, owner: string) =>
  JSON.stringify([{ name: 's4', oid: String(oid), owner, comment: null, database: 'agents' }]);
/** The full router for a delete whose declared database exists. */
const answers = (schema: string) => ({
  probe: '[{"present":1}]',
  schema,
  empty: '[{"empty":true}]',
  proof: '[{"database":"agents"}]',
});

describe('delete drops only what it can prove it created (Important 1)', () => {
  test('an absent schema is idempotent success — no DROP issued', async () => {
    const { run, stdins } = runnerWith(router(answers('[]')));
    await Effect.runPromise(
      postgresSchemaHandlers
        .delete(deleteArgs({ ...declared, cascade: true }, persisted))
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
        ),
    );
    expect(stdins.some((s) => s.startsWith('DO '))).toBe(false);
  });

  test('refuses on oid mismatch, CASCADE included — no DROP issued', async () => {
    // The recreated row kept the declared owner but a different oid: the persisted proof
    // cannot vouch for it, so the handler refuses before the emptiness check or any DROP.
    const { run, stdins } = runnerWith(router(answers(schemaRow(16443, 'seat_role'))));
    const error = await Effect.runPromise(
      Effect.flip(
        postgresSchemaHandlers
          .delete(deleteArgs({ ...declared, cascade: true }, persisted))
          .pipe(
            Effect.provide(
              postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
            ),
          ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDeleteForeignRefused);
    expect(error).toMatchObject({
      schema: 's4',
      liveOid: 16443,
      liveOwner: 'seat_role',
      lastOid: 16442,
      lastOwner: 'seat_role',
    });
    expect(stdins.some((s) => s.startsWith('DO '))).toBe(false);
    // Refused before the guarded drop, so the emptiness check never ran either.
    expect(stdins.some((s) => s.includes('AS empty'))).toBe(false);
  });

  test('refuses on owner mismatch — no DROP issued', async () => {
    // Same oid, another role: the schema under this name is no longer the one this resource
    // created, and its objects must survive the delete.
    const { run, stdins } = runnerWith(router(answers(schemaRow(16442, 'other_role'))));
    const error = await Effect.runPromise(
      Effect.flip(
        postgresSchemaHandlers
          .delete(deleteArgs(declared, persisted))
          .pipe(
            Effect.provide(
              postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
            ),
          ),
      ),
    );
    expect(error).toBeInstanceOf(PostgresSchemaDeleteForeignRefused);
    expect(error).toMatchObject({
      liveOid: 16442,
      liveOwner: 'other_role',
      lastOid: 16442,
      lastOwner: 'seat_role',
    });
    expect(stdins.some((s) => s.startsWith('DO '))).toBe(false);
  });

  test('a live row with no persisted proof fails closed — the delete client core refuses', async () => {
    // The engine passes state whenever it deletes, but the handler contract allows an
    // `undefined` output: no proof means no vouching, so a live row is refused, not dropped.
    const { run, stdins } = runnerWith(router(answers(schemaRow(16443, 'other_role'))));
    const pg = makePsqlExecutor(run, { database: 'agents', username: 'postgres' });
    const error = await Effect.runPromise(Effect.flip(deleteWithClient(pg, declared, undefined)));
    expect(error).toBeInstanceOf(PostgresSchemaDeleteForeignRefused);
    expect(error).toMatchObject({
      liveOid: 16443,
      liveOwner: 'other_role',
      lastOid: undefined,
      lastOwner: undefined,
    });
    expect(stdins.some((s) => s.startsWith('DO '))).toBe(false);
  });
});

describe('a missing declared database is schema absent (Important 2)', () => {
  test('delete of a schema whose declared database is gone is idempotent success', async () => {
    // The probe answers ABSENT: only that one statement ran — over the FAMILY connection
    // (its argv targets the maintenance database), never a connection to `agents`.
    const { run, stdins, argvs } = runnerWith(router({ probe: '[]' }));
    await Effect.runPromise(
      postgresSchemaHandlers
        .delete(deleteArgs({ ...declared, cascade: true }, persisted))
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
        ),
    );
    expect(stdins.length).toBe(1);
    expect(stdins[0]).toContain('FROM pg_catalog.pg_database');
    expect(argvs.length).toBe(1);
    expect(argvs[0]?.at(-1)).toBe('postgres');
  });

  test('read of a schema whose declared database is gone answers absent, untyped connect never happens', async () => {
    const { run, stdins } = runnerWith((stdin) => route(stdin, { probe: '[]' }) ?? '');
    const result = await Effect.runPromise(
      schemaRead(readArgs(declared)).pipe(
        Effect.provide(
          postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
        ),
      ),
    );
    expect(result).toBeUndefined();
    expect(stdins.length).toBe(1);
    expect(stdins[0]).toContain('FROM pg_catalog.pg_database');
  });

  test('the `database` override reaches `psql -d`: the probe targets the family database, the rest the declared one', async () => {
    // A live delete over a declared `agents`: the probe's argv runs `-d postgres` (the family
    // connection), while every statement after it runs `-d agents` (the override).
    const { run, stdins, argvs } = runnerWith(router(answers(schemaRow(16442, 'seat_role'))));
    await Effect.runPromise(
      postgresSchemaHandlers
        .delete(deleteArgs(declared, persisted))
        .pipe(
          Effect.provide(
            postgresRunnerConnection({ run, database: 'postgres', username: 'postgres' }),
          ),
        ),
    );
    expect(stdins.some((s) => s.startsWith('DO '))).toBe(true);
    expect(argvs[0]?.at(-1)).toBe('postgres');
    expect(argvs.slice(1).every((argv) => argv.at(-1) === 'agents')).toBe(true);
  });
});
