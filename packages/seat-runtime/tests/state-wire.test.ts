/**
 * State in the seat's trace, ON THE WIRE: the OTLP protobuf the stub receives after the scope
 * closes must name the spans and their `db.system.name`, and must not carry a value, a key or a
 * password (tests/state-trace.ts). Also the two layers together, as `SeatState.layer` builds them.
 *
 * ★ THE STUB IS THE SAME ONE THE MODEL TESTS USE (tests/stub.ts): a loopback server that keeps
 *   every request, so what is asserted is what a Victoria service would have been sent.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Effect, Redacted } from 'effect';
import * as Redis from 'effect/persistence/Redis';
import * as SqlClient from 'effect/sql/SqlClient';
import { SeatState } from '../src/state.ts';
import {
  POSTGRES_URL,
  type ScratchValkey,
  VALKEY_BINARY,
  startValkey,
  suiteWith,
} from './state-servers.ts';
import { type Stub, startStub } from './stub.ts';
import { contains, traceExportedBy, utf8 } from './state-trace.ts';

let stub: Stub;
let valkey: ScratchValkey;
beforeAll(async () => {
  stub = startStub();
  if (VALKEY_BINARY !== null) valkey = await startValkey();
});
afterAll(async () => {
  stub.stop();
  if (VALKEY_BINARY !== null) await valkey.stop();
});

const VALUE = `value-${crypto.randomUUID()}`;
const KEY = `seat:key-${crypto.randomUUID()}`;

suiteWith(VALKEY_BINARY !== null, 'valkey spans on the wire', () => {
  test('the exported trace has the command span and db.system.name=redis, and no secret', async () => {
    const trace = await traceExportedBy(
      stub,
      Effect.gen(function* () {
        const redis = yield* Redis.Redis;
        yield* redis.send('SET', KEY, VALUE);
        yield* redis.send('GET', KEY);
      }).pipe(Effect.provide(SeatState.valkey({ url: valkey.seatUrl }))),
    );
    expect(trace.length).toBeGreaterThan(0);
    for (const present of ['seat.state', 'valkey SET', 'valkey GET', 'db.system.name', 'redis']) {
      expect(contains(trace, utf8(present))).toBe(true);
    }
    for (const secret of [VALUE, KEY, valkey.password]) {
      expect(contains(trace, utf8(secret))).toBe(false);
    }
  });
});

suiteWith(POSTGRES_URL !== undefined, 'postgres spans on the wire', () => {
  test('the exported trace has sql.execute and db.system.name=postgresql, and no parameter', async () => {
    const trace = await traceExportedBy(
      stub,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`select ${VALUE}::text as v`;
      }).pipe(Effect.provide(SeatState.postgres({ url: Redacted.make(POSTGRES_URL ?? '') }))),
    );
    for (const present of ['seat.state', 'sql.execute', 'db.system.name', 'postgresql']) {
      expect(contains(trace, utf8(present))).toBe(true);
    }
    expect(contains(trace, utf8(VALUE))).toBe(false);
  });
});

suiteWith(VALKEY_BINARY !== null && POSTGRES_URL !== undefined, 'both layers together', () => {
  test('SeatState.layer serves SqlClient and Redis to one program, in one trace', async () => {
    const trace = await traceExportedBy(
      stub,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const redis = yield* Redis.Redis;
        const [row] = yield* sql<{ one: number }>`select 1 as one`;
        yield* redis.send('SET', `${valkey.prefix}both`, String(row?.one));
      }).pipe(
        Effect.provide(
          SeatState.layer({
            postgres: { url: POSTGRES_URL ?? '' },
            valkey: { url: valkey.seatUrl },
          }),
        ),
      ),
    );
    for (const present of ['sql.execute', 'postgresql', 'valkey SET', 'redis']) {
      expect(contains(trace, utf8(present))).toBe(true);
    }
  });
});
