/**
 * The Valkey layer against a scratch `valkey-server` with the ACL a seat will have: `user default
 * off` and one `seat` user restricted to the `seat:*` prefix (tests/state-servers.ts).
 *
 * ⛔ THE POINT: an out-of-prefix write is a TYPED error, not a crash and not a silent success.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Effect, Queue, Redacted, type Scope } from 'effect';
import * as Redis from 'effect/unstable/persistence/Redis';
import { SeatState } from '../src/state.ts';
import { printed } from './printed.ts';
import { type ScratchValkey, VALKEY_BINARY, startValkey, suiteWith } from './state-servers.ts';
import { withSpans } from './state-trace.ts';

let valkey: ScratchValkey;
beforeAll(async () => {
  if (VALKEY_BINARY !== null) valkey = await startValkey();
});
afterAll(async () => {
  if (VALKEY_BINARY !== null) await valkey.stop();
});

/** Run `use` against the layer built from `url`, in one scope. */
const run = <A, E>(
  url: string | Redacted.Redacted<string>,
  use: (redis: Redis.Redis['Service']) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* use(yield* Redis.Redis);
      }).pipe(Effect.provide(SeatState.valkey({ url, connectionTimeout: 3000 }))),
    ),
  );

suiteWith(VALKEY_BINARY !== null, 'valkey layer, scratch server with a seat ACL', () => {
  test('the seat user reads and writes inside its prefix', async () => {
    const exit = await run(valkey.seatUrl, (redis) =>
      Effect.gen(function* () {
        yield* redis.send('SET', 'seat:a', 'v1');
        const got = yield* redis.send<string>('GET', 'seat:a');
        const deleted = yield* redis.send<number>('DEL', 'seat:a');
        return { got, deleted };
      }),
    );
    expect(exit).toMatchObject({ _tag: 'Success', value: { got: 'v1', deleted: 1 } });
  });

  test('a Redacted URL is the same as a string', async () => {
    const exit = await run(Redacted.make(valkey.seatUrl), (redis) => redis.send<string>('PING'));
    expect(exit).toMatchObject({ _tag: 'Success', value: 'PONG' });
  });

  test('an OUT-OF-PREFIX write is a typed RedisError, and the layer stays usable', async () => {
    const exit = await run(valkey.seatUrl, (redis) =>
      Effect.gen(function* () {
        const denied = yield* redis.send('SET', 'other:a', 'x').pipe(Effect.flip);
        // ⚠️ A read outside the prefix is refused too: the ACL is `~seat:*`, not `%W~seat:*`.
        const deniedRead = yield* redis.send('GET', 'other:a').pipe(Effect.flip);
        // The route a caller takes: match the tag, not a string.
        const viaTag = yield* redis
          .send<string>('SET', 'other:b', 'x')
          .pipe(Effect.catchTag('RedisError', (error) => Effect.succeed(error)));
        yield* redis.send('SET', 'seat:after', 'ok');
        return {
          denied,
          deniedRead,
          viaTag,
          after: yield* redis.send<string>('GET', 'seat:after'),
        };
      }),
    );
    if (exit._tag !== 'Success') throw new Error(printed(exit));
    const { denied, deniedRead, viaTag, after } = exit.value;
    expect(viaTag).toBeInstanceOf(Redis.RedisError);
    expect(SeatState.isPermissionDenied(viaTag)).toBe(true);
    for (const error of [denied, deniedRead]) {
      expect(error).toBeInstanceOf(Redis.RedisError);
      expect(error._tag).toBe('RedisError');
      expect(SeatState.isPermissionDenied(error)).toBe(true);
    }
    expect((denied.cause as Error).message).toBe('NOPERM No permissions to access a key');
    expect(after).toBe('ok');
  });

  test('a command outside the seat’s categories is refused as the same typed error', async () => {
    const exit = await run(valkey.seatUrl, (redis) => redis.send('FLUSHALL').pipe(Effect.flip));
    if (exit._tag !== 'Success') throw new Error(printed(exit));
    expect(SeatState.isPermissionDenied(exit.value)).toBe(true);
    expect((exit.value.cause as Error).message).toContain("'flushall'");
  });

  test('isPermissionDenied is false for anything else', () => {
    expect(SeatState.isPermissionDenied(new Redis.RedisError({ cause: new Error('boom') }))).toBe(
      false,
    );
    expect(SeatState.isPermissionDenied(new Error('NOPERM'))).toBe(false);
    expect(SeatState.isPermissionDenied(undefined)).toBe(false);
  });

  test('eval runs a script whose keys are inside the prefix', async () => {
    const bump = Redis.script((key: string) => [key], {
      lua: "return redis.call('INCR', KEYS[1])",
      numberOfKeys: 1,
    }).withReturnType<number>();
    const exit = await run(valkey.seatUrl, (redis) =>
      Effect.gen(function* () {
        yield* redis.eval(bump)('seat:counter');
        return yield* redis.eval(bump)('seat:counter');
      }),
    );
    expect(exit).toMatchObject({ _tag: 'Success', value: 2 });
  });

  test('the default user is off: no credentials fail at build, typed', async () => {
    const exit = await run(valkey.anonymousUrl, (redis) => redis.send('PING'));
    if (exit._tag !== 'Failure') throw new Error('an anonymous client was accepted');
    expect(printed(exit)).toContain('RedisError');
  });

  test('a wrong password fails at build, typed, and the password is nowhere in it', async () => {
    const exit = await run(valkey.wrongPasswordUrl, (redis) => redis.send('PING'));
    if (exit._tag !== 'Failure') throw new Error('a wrong password was accepted');
    expect(printed(exit)).toContain('RedisError');
    expect(printed(exit)).not.toContain(valkey.password);
  });

  test('subscribe is refused as a typed RedisError, saying so', async () => {
    const exit = await run(valkey.seatUrl, (redis) =>
      Effect.gen(function* () {
        const queue = yield* redis.subscribe('seat:events');
        return yield* Queue.take(queue).pipe(Effect.flip);
      }),
    );
    if (exit._tag !== 'Success') throw new Error(printed(exit));
    expect(exit.value).toBeInstanceOf(Redis.RedisError);
    expect((exit.value.cause as Error).message).toContain('subscribe is not supported');
  });

  // ★ MEASURED 2026-09-29 through this layer: a killed server failed the next command in 1 ms, and
  //   the first command after a restart succeeded within 0.5 s. On `Bun.RedisClient`'s defaults the
  //   same command would have waited for the server (src/state-valkey-send.ts).
  test('a server that goes away fails commands at once, and the same layer works when it returns', async () => {
    const exit = await run(valkey.seatUrl, (redis) =>
      Effect.gen(function* () {
        yield* redis.send('SET', 'seat:before', '1');
        yield* Effect.promise(() => valkey.kill());
        const started = Date.now();
        const down = yield* redis.send('GET', 'seat:before').pipe(Effect.flip);
        const failedInMs = Date.now() - started;
        yield* Effect.promise(() => valkey.restart());
        // Reconnecting is Bun's: poll, so a slow machine is not a flake.
        let back: unknown = 'no answer';
        for (let attempt = 0; attempt < 20 && back === 'no answer'; attempt++) {
          yield* Effect.sleep(250);
          back = yield* redis.send('PING').pipe(Effect.orElseSucceed(() => 'no answer'));
        }
        return { down, failedInMs, back };
      }),
    );
    if (exit._tag !== 'Success') throw new Error(printed(exit));
    expect(exit.value.down).toBeInstanceOf(Redis.RedisError);
    expect(exit.value.failedInMs).toBeLessThan(1000);
    expect(exit.value.back).toBe('PONG');
  });

  test('spans: one per command, the address and no key, value or password', async () => {
    const { exit, spans } = await withSpans(
      Effect.scoped(
        Effect.gen(function* () {
          const redis = yield* Redis.Redis;
          yield* redis.send('SET', 'seat:key-canary', 'value-canary');
          yield* redis.send('SET', 'other:key-canary', 'value-canary').pipe(Effect.ignore);
        }).pipe(Effect.provide(SeatState.valkey({ url: valkey.seatUrl, connectionTimeout: 3000 }))),
      ),
    );
    expect(exit._tag).toBe('Success');
    const sets = spans.filter((span) => span.name === 'valkey SET');
    expect(sets.map((span) => span.ended)).toEqual(['Success', 'Failure']);
    expect(sets[0]?.attributes).toEqual({
      'db.system.name': 'redis',
      'server.address': '127.0.0.1',
      'server.port': valkey.port,
      'db.operation.name': 'SET',
    });
    const everything = JSON.stringify(spans);
    for (const secret of ['key-canary', 'value-canary', valkey.password]) {
      expect(everything).not.toContain(secret);
    }
  });
});
