/**
 * The RESP parser against a scripted `node:net` socket — the byte-level cases a recording fake
 * `ValkeyExecutor` cannot reach, because the fake answers `ValkeyReply` objects and never crosses
 * the wire. Two classes of bug live only here: a reply that arrives SPLIT across `data` chunks
 * (the parser must wait mid-token), and a reply that arrives WHOLE in one chunk while the parser
 * needs several sequential reads (nested arrays, bulk-after-array) — the second is the bug this
 * file was written to catch, measured on the 9.1.1 scratch on 2026-09-29: without the
 * read-once-before-listening pull, the bytes sat in the buffer while the parser waited for a
 * `data` event that had already fired.
 *
 * ⛔ THE MOCK IS A `Socket`-SHAPED OBJECT, NOT A REAL SOCKET. `readReply` touches `on`, `off`,
 *   `write`, `readableEnded` and `destroyed` and nothing else, so an event emitter with a sink
 *   for `write` is the whole contract; a live server would add a second source of truth, not a
 *   test.
 * ★ ONE `data` EVENT PER MACROTASK, like a real socket: Effect's continuation between two reads
 *   runs as a microtask, which a real socket always lets finish before the next chunk arrives.
 *   Emitting two chunks in one macrotask would swallow the second and hang — a test bug, not a
 *   parser property.
 */
import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as Effect from 'effect/Effect';
import { type ValkeyReply, makeSocketExecutor } from './transport.ts';

interface ScriptedSocket extends EventEmitter {
  write: (data: string) => boolean;
  readableEnded: boolean;
  destroyed: boolean;
}

const scriptedSocket = (): ScriptedSocket => {
  const socket = new EventEmitter() as ScriptedSocket;
  socket.write = () => true;
  socket.readableEnded = false;
  socket.destroyed = false;
  return socket;
};

/** One chunk per macrotask, in order — the timing of a real TCP socket. */
const push = async (socket: ScriptedSocket, ...chunks: Array<string | Buffer>): Promise<void> => {
  for (const chunk of chunks) {
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        socket.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        resolve();
      }, 0);
    });
  }
};

/** Send a command and let the scripted reply arrive. Returns the promise so a test can also
 * assert on a rejection. */
const send = (
  socket: ScriptedSocket,
  args: ReadonlyArray<string>,
  chunks: Array<string | Buffer>,
): Promise<ValkeyReply> => {
  const executor = makeSocketExecutor(socket as never);
  const pending = Effect.runPromise(executor.send(args));
  return push(socket, ...chunks).then(() => pending) as Promise<ValkeyReply>;
};

describe('flat replies', () => {
  test('a simple string arrives as a bulk value', async () => {
    expect(await send(scriptedSocket(), ['PING'], ['+PONG\r\n'])).toEqual({
      kind: 'bulk',
      value: 'PONG',
    });
  });

  test('a nil bulk is null, not the empty string', async () => {
    expect(await send(scriptedSocket(), ['GET', 'x'], ['$-1\r\n'])).toEqual({
      kind: 'bulk',
      value: null,
    });
  });

  test('an integer reply carries its digits as a bulk value', async () => {
    expect(await send(scriptedSocket(), ['DEL', 'x'], [':2\r\n'])).toEqual({
      kind: 'bulk',
      value: '2',
    });
  });

  test('an error line fails with the server tag, not a die', async () => {
    const socket = scriptedSocket();
    const error = (await send(socket, ['ACL', 'LIST'], ['-ERR unknown command\r\n']).catch(
      (cause: unknown) => cause,
    )) as { _tag?: string; detail?: string };
    expect(error._tag).toBe('ValkeyServerError');
    expect(error.detail).toBe('ERR unknown command');
  });
});

describe('split and accumulated chunks', () => {
  test('a bulk split mid-length and mid-body is reassembled', async () => {
    const reply = await send(scriptedSocket(), ['INFO'], ['$9\r\nred', 'isvers\r\n']);
    expect(reply).toEqual({ kind: 'bulk', value: 'redisvers' });
  });

  test('a flat array split across three chunks is reassembled in order', async () => {
    const reply = await send(
      scriptedSocket(),
      ['ACL', 'LIST'],
      ['*2\r\n$4\r\n', 'user\r', '\n$5\r\ncs-ar\r\n'],
    );
    expect(reply).toEqual({ kind: 'array', values: ['user', 'cs-ar'] });
  });

  test('a whole nested-array reply in ONE chunk is read to the end — the 2026-09-29 hang', async () => {
    // `ACL GETUSER`'s real shape on Valkey 9.1.1: outer `*N`, some items nested `*1`/`*0`
    // arrays. This family reads only flat arrays, so the parser must FAIL LOUDLY on the nested
    // item instead of null-flattening it — and must never hang waiting for bytes it holds.
    const socket = scriptedSocket();
    const chunk = '*2\r\n$2\r\nok\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n';
    const error = (await send(socket, ['ACL', 'GETUSER', 'x'], [chunk]).catch(
      (cause: unknown) => cause,
    )) as { _tag?: string; detail?: string };
    expect(error._tag).toBe('ValkeyServerError');
    expect(error.detail).toContain('nested array');
  });

  test('sequential sends on one socket each start a fresh reply buffer', async () => {
    const socket = scriptedSocket();
    const executor = makeSocketExecutor(socket as never);
    const first = Effect.runPromise(executor.send(['PING']));
    await push(socket, '+PONG\r\n');
    expect(await first).toEqual({ kind: 'bulk', value: 'PONG' });
    const second = Effect.runPromise(executor.send(['PING']));
    await push(socket, '+PONG\r\n');
    expect(await second).toEqual({ kind: 'bulk', value: 'PONG' });
  });
});

describe('a socket that closes', () => {
  test('closed before the read starts fails fast instead of hanging', async () => {
    const socket = scriptedSocket();
    socket.readableEnded = true;
    const error = (await Effect.runPromise(
      makeSocketExecutor(socket as never).send(['PING']),
    ).catch((cause: unknown) => cause)) as { _tag?: string };
    expect(error._tag).toBe('ValkeySocketError');
  });

  test('closed mid-reply rejects the pending read', async () => {
    const socket = scriptedSocket();
    const executor = makeSocketExecutor(socket as never);
    const pending = Effect.runPromise(executor.send(['INFO']));
    await push(socket, '$10\r\nred'); // partial bulk, then the server goes away
    socket.emit('end');
    const error = (await pending.catch((cause: unknown) => cause)) as {
      _tag?: string;
      reason?: string;
    };
    expect(error._tag).toBe('ValkeySocketError');
    expect(error.reason).toBe('socket closed mid-reply');
  });
});
