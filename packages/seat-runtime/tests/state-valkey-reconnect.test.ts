/**
 * The Valkey layer against a real server that is down for LONGER THAN BUN RETRIES.
 *
 * 🔴 THE CASE tests/state-valkey.test.ts CANNOT SEE: its outage is under a second, which Bun's own
 *   reconnect covers. Past `maxRetries` (default 20, about 31 s of outage; measured 2026-09-29) the
 *   client is dead for good unless something calls `connect()` again, and every retry a seat made
 *   hit the same dead client (src/state-valkey-connection.ts).
 * ★ `maxRetries: 2` MAKES BUN GIVE UP AFTER ABOUT 0.3 s, so the outage below is many times its
 *   budget without the test taking half a minute. The default budget was run by hand, and the
 *   number is in the PR.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Effect } from 'effect';
import * as Redis from 'effect/unstable/persistence/Redis';
import { SeatState } from '../src/state.ts';
import { printed } from './printed.ts';
import { type ScratchValkey, VALKEY_BINARY, startValkey, suiteWith } from './state-servers.ts';

let valkey: ScratchValkey;
beforeAll(async () => {
  if (VALKEY_BINARY !== null) valkey = await startValkey();
});
afterAll(async () => {
  if (VALKEY_BINARY !== null) await valkey.stop();
});

suiteWith(VALKEY_BINARY !== null, 'valkey layer, an outage past Bun’s retry budget', () => {
  test('commands fail at once meanwhile, and the same layer works when the server returns', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const redis = yield* Redis.Redis;
          yield* redis.send('SET', 'seat:before', '1');
          yield* Effect.promise(() => valkey.kill());
          // Ten times what Bun needs to give up with `maxRetries: 2`.
          yield* Effect.sleep(3000);
          const started = Date.now();
          const down = yield* redis.send('GET', 'seat:before').pipe(Effect.flip);
          const failedInMs = Date.now() - started;
          yield* Effect.promise(() => valkey.restart());
          // The layer's own loop pauses up to 5 s between attempts: poll for longer than that.
          let back: unknown = 'no answer';
          for (let attempt = 0; attempt < 60 && back === 'no answer'; attempt++) {
            yield* Effect.sleep(250);
            back = yield* redis.send('PING').pipe(Effect.orElseSucceed(() => 'no answer'));
          }
          yield* redis.send('SET', 'seat:after', '2');
          return { down, failedInMs, back, after: yield* redis.send<string>('GET', 'seat:after') };
        }).pipe(
          Effect.provide(
            SeatState.valkey({ url: valkey.seatUrl, connectionTimeout: 3000, maxRetries: 2 }),
          ),
        ),
      ),
    );
    if (exit._tag !== 'Success') throw new Error(printed(exit));
    expect(exit.value.down).toBeInstanceOf(Redis.RedisError);
    expect(exit.value.failedInMs).toBeLessThan(1000);
    expect(exit.value.back).toBe('PONG');
    expect(exit.value.after).toBe('2');
  }, 30_000);
});
