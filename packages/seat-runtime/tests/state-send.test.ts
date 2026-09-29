/**
 * One Valkey command as a span with a deadline (src/state-valkey-send.ts), against a fake client:
 * no server, so this runs in CI where `valkey-server` is not installed.
 */
import { describe, expect, test } from 'bun:test';
import { Cause, Effect } from 'effect';
import * as Redis from 'effect/unstable/persistence/Redis';
import { instrumentedSend } from '../src/state-valkey-send.ts';
import { withSpans } from './state-trace.ts';

const ATTRIBUTES = { 'db.system.name': 'redis', 'server.address': '10.0.0.9', 'server.port': 6381 };

const options = (ms: number) => ({
  commandTimeout: ms,
  commandTimeoutMs: ms,
  attributes: ATTRIBUTES,
});

describe('instrumentedSend', () => {
  test('the span names the command and carries the address, never a key or a value', async () => {
    const calls: Array<[string, string[]]> = [];
    const send = instrumentedSend(
      {
        send: async (command, args) => {
          calls.push([command, args]);
          return 'OK';
        },
      },
      options(1000),
    );
    const { exit, spans } = await withSpans(send('set', 'seat:key-canary', 'value-canary'));
    expect(exit._tag).toBe('Success');
    expect(calls).toEqual([['set', ['seat:key-canary', 'value-canary']]]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('valkey SET');
    expect(spans[0]?.attributes).toEqual({ ...ATTRIBUTES, 'db.operation.name': 'SET' });
    expect(JSON.stringify(spans)).not.toContain('canary');
  });

  test('a rejected command is a typed RedisError carrying the client’s own error', async () => {
    const send = instrumentedSend(
      { send: () => Promise.reject(new Error('NOPERM No permissions to access a key')) },
      options(1000),
    );
    const { exit, spans } = await withSpans(send('SET', 'other:a', 'x'));
    if (exit._tag !== 'Failure') throw new Error('expected a failure');
    const error = await Effect.runPromise(Effect.flip(send('SET', 'other:a', 'x')));
    expect(error).toBeInstanceOf(Redis.RedisError);
    expect(error._tag).toBe('RedisError');
    expect(String((error.cause as Error).message)).toStartWith('NOPERM');
    expect(spans[0]?.ended).toBe('Failure');
  });

  test('a refused call’s error text loses the arguments the server quotes, in the RedisError and the span', async () => {
    const server =
      "ERR unknown command 'JSON.SET', with args beginning with: 'seat:key-canary' '$' 'value-canary' ";
    const send = instrumentedSend(
      {
        send: () =>
          Promise.reject(Object.assign(new Error(server), { code: 'ERR_REDIS_SERVER_ERROR' })),
      },
      options(1000),
    );
    const error = await Effect.runPromise(
      Effect.flip(send('JSON.SET', 'seat:key-canary', '$', 'value-canary')),
    );
    expect(error).toBeInstanceOf(Redis.RedisError);
    expect(String((error.cause as Error).message)).toStartWith("ERR unknown command 'JSON.SET'");
    const { exit } = await withSpans(send('JSON.SET', 'seat:key-canary', '$', 'value-canary'));
    if (exit._tag !== 'Failure') throw new Error('expected a failure');
    // What a tracer reads off a failed span: the cause's errors, with their cause chain in the stack.
    for (const pretty of Cause.prettyErrors(exit.cause, { includeCauseInStack: true })) {
      expect(`${pretty.message}${pretty.stack ?? ''}`).not.toContain('canary');
    }
  });

  test('a command nobody answers fails as RedisError at the deadline, and says which', async () => {
    const send = instrumentedSend({ send: () => new Promise<never>(() => {}) }, options(60));
    const started = Date.now();
    const { exit, spans } = await withSpans(send('get', 'seat:a'));
    expect(Date.now() - started).toBeLessThan(2000);
    if (exit._tag !== 'Failure') throw new Error('expected a failure');
    const error = await Effect.runPromise(Effect.flip(send('get', 'seat:a')));
    expect(error).toBeInstanceOf(Redis.RedisError);
    expect((error.cause as Error).message).toBe('valkey GET did not answer within 60 ms');
    expect(spans[0]?.ended).toBe('Failure');
  });

  test('the answer comes back as the caller typed it', async () => {
    const send = instrumentedSend({ send: async () => 'v1' }, options(1000));
    const value: string = await Effect.runPromise(send<string>('GET', 'seat:a'));
    expect(value).toBe('v1');
  });
});
