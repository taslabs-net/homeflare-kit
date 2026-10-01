/**
 * Bounds on the socket this family owns. `transport.test.ts` covers split replies and
 * `end`; these cases are the ones that stall or kill a deploy: an `error` after connect,
 * a reply length the server names, and a deadline on a socket that never answers.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { EventEmitter } from 'node:events';
import { type Socket as NetSocket, createServer } from 'node:net';
import { valkeyConnection, withValkey } from './connection.ts';
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

const push = async (socket: ScriptedSocket, chunk: string): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      socket.emit('data', Buffer.from(chunk));
      resolve();
    }, 0);
  });
};

const send = (socket: ScriptedSocket, chunks: ReadonlyArray<string>): Promise<ValkeyReply> => {
  const pending = Effect.runPromise(makeSocketExecutor(socket as never).send(['INFO']));
  return chunks
    .reduce((chain, chunk) => chain.then(() => push(socket, chunk)), Promise.resolve())
    .then(() => pending);
};

const tagOf = async (pending: Promise<unknown>): Promise<{ _tag?: string; reason?: string }> =>
  (await pending.catch((cause: unknown) => cause)) as { _tag?: string; reason?: string };

const listen = (hold: boolean): Promise<{ port: number; close: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const peers: NetSocket[] = [];
    const server = createServer((peer) => {
      peers.push(peer);
      if (!hold) peer.resetAndDestroy();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            for (const peer of peers) peer.destroy();
            server.close(() => done());
          }),
      });
    });
  });

describe('socket error after connect', () => {
  test('an error during a read is ValkeySocketError, not an uncaught throw', async () => {
    const socket = scriptedSocket();
    const executor = makeSocketExecutor(socket as never, 500);
    const pending = Effect.runPromise(executor.send(['PING']));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(() => socket.emit('error', new Error('read ECONNRESET'))).not.toThrow();
    const error = await tagOf(pending);
    expect(error._tag).toBe('ValkeySocketError');
    expect(error.reason).toContain('ECONNRESET');
  });

  test('an error with no in-flight read does not throw', () => {
    const socket = scriptedSocket();
    makeSocketExecutor(socket as never);
    expect(() => socket.emit('error', new Error('read ECONNRESET'))).not.toThrow();
  });

  test('a peer RST during a read returns ValkeySocketError', async () => {
    const server = await listen(false);
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          withValkey((executor) => executor.send(['PING'])).pipe(
            Effect.provide(
              valkeyConnection({ host: '127.0.0.1', port: server.port, timeoutMs: 1_000 }),
            ),
          ),
        ),
      );
      expect((error as { _tag?: string })._tag).toBe('ValkeySocketError');
    } finally {
      await server.close();
    }
  });
});

describe('reply caps', () => {
  test('a bulk length of 2147483647 fails instead of waiting for the body', async () => {
    const error = await tagOf(send(scriptedSocket(), ['$2147483647\r\n']));
    expect(error._tag).toBe('ValkeySocketError');
  });

  test('an array count of 1000000000 fails instead of looping', async () => {
    const error = await tagOf(send(scriptedSocket(), ['*1000000000\r\n']));
    expect(error._tag).toBe('ValkeySocketError');
  });
});

describe('deadlines on a real socket', () => {
  test('connect to a blackholed host fails with ValkeySocketError', async () => {
    const started = Date.now();
    const error = await Effect.runPromise(
      Effect.flip(
        withValkey((executor) => executor.send(['PING'])).pipe(
          Effect.provide(valkeyConnection({ host: '192.0.2.1', port: 1, timeoutMs: 200 })),
        ),
      ),
    );
    expect((error as { _tag?: string })._tag).toBe('ValkeySocketError');
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test('an accepted socket that sends nothing fails with ValkeySocketError', async () => {
    const server = await listen(true);
    const started = Date.now();
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          withValkey((executor) => executor.send(['PING'])).pipe(
            Effect.provide(
              valkeyConnection({ host: '127.0.0.1', port: server.port, timeoutMs: 200 }),
            ),
          ),
        ),
      );
      expect((error as { _tag?: string })._tag).toBe('ValkeySocketError');
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      await server.close();
    }
  });
});
