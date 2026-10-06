/**
 * The Postgres layer against a scratch database (`SEAT_RUNTIME_TEST_POSTGRES_URL`, tests/
 * state-servers.ts): a real round trip, the spans the driver makes, and the failures.
 *
 * ⛔ ONLY TABLES THIS FILE MAKES ARE TOUCHED, each with a per-run name, dropped at the end.
 */
import { afterAll, expect, test } from 'bun:test';
import { PgClient } from '@effect/sql-pg';
import { Effect, Layer, Redacted } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as SqlClient from 'effect/sql/SqlClient';
import { SqlError } from 'effect/sql/SqlError';
import { SeatState } from '../src/state.ts';
import { printed } from './printed.ts';
import { POSTGRES_URL, suiteWith } from './state-servers.ts';
import { withSpans } from './state-trace.ts';

const url = POSTGRES_URL ?? 'postgres://unset@127.0.0.1:1/unset';
const target = new URL(url);
const database = decodeURIComponent(target.pathname.slice(1));
const table = `seat_state_${crypto.randomUUID().replaceAll('-', '')}`;
/** A value that must be in the table and must not be in a span. */
const CANARY = `canary-${crypto.randomUUID()}`;

const layer = () => SeatState.postgres({ url: Redacted.make(url), connectTimeout: 5000 });

afterAll(async () => {
  if (POSTGRES_URL === undefined) return;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.unsafe(`drop table if exists ${table}`);
      }).pipe(Effect.provide(layer())),
    ),
  );
});

suiteWith(POSTGRES_URL !== undefined, 'postgres layer, scratch database', () => {
  test('a real round trip: create, insert with a parameter, select, and PgClient is served too', async () => {
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const pg = yield* PgClient.PgClient;
      yield* sql.unsafe(`create table ${table} (id serial primary key, note text not null)`);
      yield* sql`insert into ${sql(table)} (note) values (${CANARY})`;
      const rows = yield* sql<{ note: string }>`select note from ${sql(table)}`;
      return { rows, pgServed: typeof pg.json === 'function' };
    }).pipe(Effect.provide(layer()), Effect.scoped);
    const result = await Effect.runPromise(program);
    expect(result.rows).toEqual([{ note: CANARY }]);
    expect(result.pgServed).toBe(true);
  });

  test('spans: the database that was reached, not the driver’s defaults, and no parameter value', async () => {
    const { exit, spans } = await withSpans(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`select note from ${sql(table)} where note = ${CANARY}`;
      }).pipe(Effect.provide(layer()), Effect.scoped),
    );
    expect(exit._tag).toBe('Success');
    const query = spans.filter((span) => span.name === 'sql.execute').at(-1);
    expect(query?.attributes).toMatchObject({
      'db.system.name': 'postgresql',
      'db.namespace': database,
      'server.address': target.hostname,
      'server.port': Number(target.port),
    });
    // 🔴 From `url` alone the driver says localhost:5432, database "postgres" (state-dsn.ts).
    expect(query?.attributes['server.port']).not.toBe(5432);
    expect(JSON.stringify(spans)).not.toContain(CANARY);
  });

  test('a database that does not exist fails at build as SqlError', async () => {
    const missing = new URL(url);
    missing.pathname = `/${database}_does_not_exist`;
    const exit = await Effect.runPromiseExit(
      Effect.scoped(Layer.build(SeatState.postgres({ url: missing.href, connectTimeout: 3000 }))),
    );
    if (exit._tag !== 'Failure') throw new Error('a missing database was accepted');
    expect(printed(exit)).toContain('SqlError');
    expect(printed(exit)).toContain('does not exist');
  });

  // ★ Skipped on a trust-auth scratch database (a URL with no password): there is no password to
  //   get wrong. Point the variable at a scram-sha-256 database, as CT100's is for any client that
  //   is not on its own loopback, to run it.
  test.skipIf(target.password === '')(
    'a wrong password fails at build as SqlError, and neither password is in it',
    async () => {
      const wrong = new URL(url);
      wrong.password = `wrong-${crypto.randomUUID()}`;
      const exit = await Effect.runPromiseExit(
        Effect.scoped(Layer.build(SeatState.postgres({ url: wrong.href, connectTimeout: 3000 }))),
      );
      if (exit._tag !== 'Failure') throw new Error('a wrong password was accepted');
      const text = printed(exit);
      expect(text).toContain('SqlError');
      expect(text).not.toContain(decodeURIComponent(target.password));
      expect(text).not.toContain(decodeURIComponent(wrong.password));
    },
  );

  test('a query that fails is a typed SqlError, and the client stays usable', async () => {
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const error = yield* sql`select nope from ${sql(table)}`.pipe(Effect.flip);
      const after = yield* sql<{ one: number }>`select 1 as one`;
      return { error, after };
    }).pipe(Effect.provide(layer()), Effect.scoped);
    const { error, after } = await Effect.runPromise(program);
    expect(error).toBeInstanceOf(SqlError);
    expect(after).toEqual([{ one: 1 }]);
  });

  test('fromEnv builds the same client from a variable it is told', async () => {
    const program = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ db: string }>`select current_database() as db`;
    }).pipe(
      Effect.provide(
        SeatState.postgresFromEnv({ variable: 'MY_SEAT_DSN', connectTimeout: 5000 }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ MY_SEAT_DSN: url }))),
        ),
      ),
      Effect.scoped,
    );
    expect(await Effect.runPromise(program)).toEqual([{ db: database }]);
  });
});
