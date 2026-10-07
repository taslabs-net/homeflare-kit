/**
 * The layers when the store is NOT there, or the input is wrong: typed failures, quick, and no
 * secret in anything an error prints. No server is needed, so this runs in CI.
 *
 * ⛔ "NO SECRET" MEANS `printed()`, NOT `message`. The driver's DSN error carries the string only
 *   in its `cause`, which `error.message` never shows (src/state-dsn.ts, measured 2026-09-29).
 */
import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Redis from 'effect/persistence/Redis';
import { SqlError } from 'effect/sql/SqlError';
import { SeatState } from '../src/state.ts';
import { freePort } from './state-servers.ts';
import { printed } from './printed.ts';

const SECRET = `pw-${crypto.randomUUID()}`;

/** Build a layer and return its failure (the test fails if it builds). */
const failureOf = <A, E>(layer: Layer.Layer<A, E>): Promise<E> =>
  Effect.runPromise(Effect.scoped(Layer.build(layer)).pipe(Effect.flip));

const fromEnv = (env: Record<string, string>) =>
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)));

describe('postgres', () => {
  test.each([
    ['a string that is not a URL', `not a url ${SECRET}`],
    ['a URL with an impossible port', `postgres://u:${SECRET}@host:notaport/db`],
    ['an unterminated IPv6 host', `postgres://u:${SECRET}@[::1/db`],
    ['another scheme', `mysql://u:${SECRET}@host/db`],
    ['sslmode=prefer, which the driver refuses', `postgres://u:${SECRET}@host/db?sslmode=prefer`],
  ])('%s fails as SqlError and prints no password', async (_name, url) => {
    const error = await failureOf(SeatState.postgres({ url }));
    expect(error).toBeInstanceOf(SqlError);
    expect(printed(error)).not.toContain(SECRET);
  });

  test('a refused connection fails as SqlError within connectTimeout, no password in it', async () => {
    const url = `postgres://u:${SECRET}@127.0.0.1:${String(freePort())}/db`;
    const started = Date.now();
    const error = await failureOf(SeatState.postgres({ url, connectTimeout: 1500 }));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(error).toBeInstanceOf(SqlError);
    expect(printed(error)).not.toContain(SECRET);
  });

  test('a server that accepts and says nothing fails at connectTimeout, not never', async () => {
    const hole = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, open() {} } });
    try {
      const started = Date.now();
      const error = await failureOf(
        SeatState.postgres({
          url: `postgres://u:${SECRET}@127.0.0.1:${String(hole.port)}/db`,
          connectTimeout: 400,
        }),
      );
      expect(Date.now() - started).toBeLessThan(5000);
      expect(error).toBeInstanceOf(SqlError);
      expect(printed(error)).not.toContain(SECRET);
    } finally {
      hole.stop(true);
    }
  });

  test('the error names the reason, not the string', async () => {
    const error = await failureOf(SeatState.postgres({ url: 'not a url' }));
    expect(error.message).toBe('SeatState postgres: the URL is not a postgres:// URL');
  });

  test('fromEnv: a missing variable is a ConfigError that names it', async () => {
    const error = await failureOf(SeatState.postgresFromEnv().pipe(fromEnv({})));
    expect(error._tag).toBe('ConfigError');
    expect(String(error)).toContain('SEAT_POSTGRES_URL');
  });

  test('fromEnv: reads the variable it is told, and holds the URL redacted', async () => {
    const layer = SeatState.postgresFromEnv({ variable: 'MY_DSN', connectTimeout: 300 }).pipe(
      fromEnv({ MY_DSN: `postgres://u:${SECRET}@127.0.0.1:${String(freePort())}/db` }),
    );
    const error = await failureOf(layer);
    // It got as far as connecting, so the variable was read: the failure is the driver's.
    expect(error).toBeInstanceOf(SqlError);
    expect(printed(error)).not.toContain(SECRET);
  });
});

describe('valkey', () => {
  test.each([
    ['a string that is not a URL', `not a url ${SECRET}`],
    ['another scheme', `postgres://u:${SECRET}@host/db`],
  ])('%s fails as RedisError and prints no password', async (_name, url) => {
    const error = await failureOf(SeatState.valkey({ url }));
    expect(error).toBeInstanceOf(Redis.RedisError);
    expect(error._tag).toBe('RedisError');
    expect(printed(error)).not.toContain(SECRET);
  });

  test('a refused connection is retried until connectionTimeout, then fails as RedisError', async () => {
    // ★ Measured 2026-09-29: Bun retries a refused connect (autoReconnect) until its own timeout,
    //   so a server that is a moment late is waited for; a server that is down costs the timeout.
    const started = Date.now();
    const error = await failureOf(
      SeatState.valkey({
        url: `redis://seat:${SECRET}@127.0.0.1:${String(freePort())}`,
        connectionTimeout: 700,
      }),
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(error).toBeInstanceOf(Redis.RedisError);
    expect(printed(error)).not.toContain(SECRET);
  });

  test('a server that accepts and says nothing fails at connectionTimeout, not never', async () => {
    const hole = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, open() {} } });
    try {
      const started = Date.now();
      const error = await failureOf(
        SeatState.valkey({
          url: `redis://seat:${SECRET}@127.0.0.1:${String(hole.port)}`,
          connectionTimeout: 500,
        }),
      );
      expect(Date.now() - started).toBeLessThan(3000);
      expect(error).toBeInstanceOf(Redis.RedisError);
      expect(printed(error)).not.toContain(SECRET);
    } finally {
      hole.stop(true);
    }
  });

  test('a name that never resolves is bounded by connectionTimeout, which Bun alone does not do', async () => {
    // 🔴 Measured 2026-09-29: Bun's own `connectionTimeout: 700` let this take 31 s.
    const started = Date.now();
    const error = await failureOf(
      SeatState.valkey({
        url: `redis://seat:${SECRET}@no-such-host.invalid:6379`,
        connectionTimeout: 500,
      }),
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(error).toBeInstanceOf(Redis.RedisError);
    expect(printed(error)).not.toContain(SECRET);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
    'connectionTimeout %p is a RangeError defect before anything connects',
    async (connectionTimeout) => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Layer.build(SeatState.valkey({ url: 'redis://127.0.0.1:1', connectionTimeout })),
        ),
      );
      expect(exit._tag).toBe('Failure');
      expect(printed(exit)).toContain('RangeError');
    },
  );

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'maxRetries %p is a RangeError defect before anything connects',
    async (maxRetries) => {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(Layer.build(SeatState.valkey({ url: 'redis://127.0.0.1:1', maxRetries }))),
      );
      expect(exit._tag).toBe('Failure');
      expect(printed(exit)).toContain('RangeError');
    },
  );

  test('fromEnv: a missing variable is a ConfigError that names it', async () => {
    const error = await failureOf(SeatState.valkeyFromEnv().pipe(fromEnv({})));
    expect(error._tag).toBe('ConfigError');
    expect(String(error)).toContain('SEAT_VALKEY_URL');
  });

  test('layerFromEnv asks for both variables', async () => {
    const error = await failureOf(
      SeatState.layerFromEnv({ postgres: { variable: 'A_DSN' } }).pipe(fromEnv({})),
    );
    expect(error._tag).toBe('ConfigError');
  });
});
