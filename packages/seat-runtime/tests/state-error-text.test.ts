/**
 * What a FAILED state call puts in the exported trace: the OTLP payload a Victoria service would
 * receive (tests/state-trace.ts), read after the scope closed and flushed.
 *
 * 🔴 `OtlpTracer` EXPORTS A FAILED SPAN'S ERROR, cause chain included (`exception.message`,
 *   `exception.stacktrace`), so an error text that quotes an argument puts seat data in the trace
 *   even though the span's attributes never held it. Measured 2026-09-29 before this was fixed: a
 *   Valkey `unknown command` error carried the key and the value into the payload.
 * ⚠️ POSTGRES IS NOT FIXED, ONLY PINNED. `@effect/sql-pg` builds the span and the error itself and
 *   has no hook, so a statement the server refuses while quoting a parameter (`invalid input syntax
 *   for type integer: "…"`) puts that value in the payload. The test below asserts the leak is
 *   still there, so that a driver that stops doing it fails it, and docs/state.md gets corrected.
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

suiteWith(VALKEY_BINARY !== null, 'valkey error text on the wire', () => {
  test('an unknown command that carries a key and a value: the trace has the failure, not the seat data', async () => {
    const trace = await traceExportedBy(
      stub,
      Effect.gen(function* () {
        const redis = yield* Redis.Redis;
        // A Valkey without the JSON module: a realistic call that the server refuses by echoing it.
        const error = yield* redis
          .send('JSON.SET', KEY, '$', JSON.stringify({ secret: VALUE }))
          .pipe(Effect.flip);
        // The caller's own error is scrubbed too: a `logError` of it would export the same text.
        expect(error).toBeInstanceOf(Redis.RedisError);
        expect(`${String((error.cause as Error).message)}${String(error.cause)}`).not.toContain(
          VALUE,
        );
      }).pipe(Effect.provide(SeatState.valkey({ url: valkey.seatUrl }))),
    );
    for (const present of ['valkey JSON.SET', 'exception', 'unknown command']) {
      expect(contains(trace, utf8(present))).toBe(true);
    }
    for (const secret of [KEY, VALUE, valkey.password]) {
      expect(contains(trace, utf8(secret))).toBe(false);
    }
  });

  test('an unknown subcommand quotes its first argument: a key passed by mistake stays out', async () => {
    const trace = await traceExportedBy(
      stub,
      Effect.gen(function* () {
        const redis = yield* Redis.Redis;
        yield* redis.send('OBJECT', KEY).pipe(Effect.ignore);
      }).pipe(Effect.provide(SeatState.valkey({ url: valkey.seatUrl }))),
    );
    for (const present of ['valkey OBJECT', 'unknown subcommand']) {
      expect(contains(trace, utf8(present))).toBe(true);
    }
    expect(contains(trace, utf8(KEY))).toBe(false);
  });
});

suiteWith(POSTGRES_URL !== undefined, 'postgres error text on the wire', () => {
  test('KNOWN LIMIT: a value the server quotes in its error reaches the exported trace', async () => {
    const trace = await traceExportedBy(
      stub,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`select ${VALUE}::int`.pipe(Effect.ignore);
      }).pipe(Effect.provide(SeatState.postgres({ url: Redacted.make(POSTGRES_URL ?? '') }))),
    );
    expect(contains(trace, utf8('sql.execute'))).toBe(true);
    // ⚠️ `true` on purpose: this is what `@effect/sql-pg` rc.115 does, and docs/state.md says so.
    expect(contains(trace, utf8(VALUE))).toBe(true);
  });
});
