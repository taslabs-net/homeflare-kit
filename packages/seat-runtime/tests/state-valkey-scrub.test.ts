/**
 * What a Valkey error may say once it has left the layer (src/state-valkey-scrub.ts). The server
 * texts below are the ones MEASURED against Valkey 9.1.1 on 2026-09-29, canary values and all.
 */
import { describe, expect, test } from 'bun:test';
import { OMITTED, cutArguments, scrubbedError } from '../src/state-valkey-scrub.ts';

const KEY = 'seat:key-CANARY';
const VALUE = '{"secret":"CANARY"}';

describe('cutArguments', () => {
  test('an unknown command keeps its name and loses every argument', () => {
    const server = `ERR unknown command 'JSON.SET', with args beginning with: '${KEY}' '$' '${VALUE}' `;
    expect(cutArguments(server, 'JSON.SET')).toBe(
      `ERR unknown command 'JSON.SET', with args beginning with: ${OMITTED}`,
    );
  });

  test('an unknown subcommand is an argument too', () => {
    expect(cutArguments(`ERR unknown subcommand '${KEY}'. Try OBJECT HELP.`, 'OBJECT')).toBe(
      `ERR unknown subcommand ${OMITTED}`,
    );
  });

  test('an argument that holds a quote itself is cut at its first one', () => {
    const server = "ERR unknown command 'X', with args beginning with: 'a'CANARY'b' ";
    const cut = cutArguments(server, 'X');
    expect(cut).not.toContain('CANARY');
    expect(cut).toEndWith(OMITTED);
  });

  test.each([
    ['NOPERM No permissions to access a key', 'SET'],
    ["NOPERM User seat has no permissions to run the 'flushall' command", 'FLUSHALL'],
    ["NOPERM User seat has no permissions to run the 'config|set' command", 'CONFIG'],
    ["ERR wrong number of arguments for 'set' command", 'SET'],
    ['ERR value is not an integer or out of range', 'INCR'],
    ['WRONGTYPE Operation against a key holding the wrong kind of value', 'LPUSH'],
    ['NOSCRIPT No matching script.', 'EVALSHA'],
    ['Connection closed', 'GET'],
  ])('%p is left whole', (message, command) => {
    expect(cutArguments(message, command)).toBe(message);
  });
});

describe('scrubbedError', () => {
  const bun = Object.assign(
    new Error(`ERR unknown command 'JSON.SET', with args beginning with: '${KEY}' '${VALUE}' `),
    { name: 'RedisError', code: 'ERR_REDIS_SERVER_ERROR' },
  );

  test('is a fresh Error: Bun’s name and code, the cut text, and no chained original', () => {
    const scrubbed = scrubbedError(bun, 'JSON.SET');
    expect(scrubbed).not.toBe(bun);
    expect(scrubbed.name).toBe('RedisError');
    expect((scrubbed as Error & { code?: string }).code).toBe('ERR_REDIS_SERVER_ERROR');
    expect(scrubbed.cause).toBeUndefined();
    // Every route a tracer, a logger or a debugger takes to the text.
    for (const text of [scrubbed.message, String(scrubbed), scrubbed.stack ?? '']) {
      expect(text).not.toContain('CANARY');
    }
    expect(scrubbed.message).toContain("unknown command 'JSON.SET'");
  });

  test('NOSCRIPT is still findable by `String(error)`, as Effect’s `eval` needs', () => {
    const noscript = scrubbedError(
      Object.assign(new Error('NOSCRIPT No matching script.'), { name: 'RedisError' }),
      'EVALSHA',
    );
    expect(String(noscript)).toContain('NOSCRIPT');
  });

  test('something that is not an Error is cut the same way', () => {
    const scrubbed = scrubbedError(`unknown command 'X', with args beginning with: '${KEY}'`, 'X');
    expect(scrubbed.message).not.toContain('CANARY');
    expect(scrubbed.message).toEndWith(OMITTED);
  });
});
