/**
 * The RESP wire the `Valkey` family speaks, hand-rolled the same way `postgres/database-sql.ts`
 * hand-rolls its four statements: there is no `@distilled.cloud/valkey` SDK (registry 404, checked
 * 2026-09-29), and `effect@4.0.0-rc.115` ships no Valkey/Redis client, so the family declares a
 * `ValkeyExecutor` seam — the real socket client below, or `fake-valkey.ts` in tests — and every
 * lifecycle function depends only on that small interface, never on `node:net`.
 * ★ Alchemy beta.79 DOES ship Redis.connect. Its internal parser/queue cannot enforce our
 *   reply caps before allocating, and it exposes no deadline settings. The audited exception
 *   and executable measurements are in `docs/valkey-transport.md`.
 *
 * ⛔ RESP, NOT A TAG TO VALKEY'S C VERSION. The protocol is line-and-prefix oriented and stable
 *   across Valkey's releases; the commands this family issues (`INFO`, `CONFIG GET`, `ACL LIST`,
 *   `ACL SETUSER`, `PING`) are all long-settled. Nothing here parses a version-specific field.
 * ★ RUNTIME-NEUTRAL. The executor is a function of `node:net` sockets, no Bun API; a Bun-only
 *   consumer would be a regression the postgres family's own `PgClient` avoided.
 * ⛔ AN `error` EVENT WITH NO LISTENER EXITS THE PROCESS. `openSocket` listens only until
 *   `connect`. This executor installs the listener that stays for the life of the socket, and
 *   fails the in-flight read with `ValkeySocketError` (measured 2026-09-30: a peer RST after
 *   the connect listener was dropped was `uncaughtException` `read ECONNRESET`, exit 1).
 */
import * as Effect from 'effect/Effect';
import type { Socket } from 'node:net';
import { type InFlight, type ReadBuf, readReply } from './resp.ts';
import {
  type ValkeyReply,
  ValkeySocketError,
  type ValkeyTransportError,
} from './transport-error.ts';

export type { ValkeyReply, ValkeyTransportError } from './transport-error.ts';
export { ValkeyServerError, ValkeySocketError } from './transport-error.ts';

/** One command with its arguments, as the byte strings that go on the wire. */
export interface ValkeyCommand {
  readonly args: ReadonlyArray<string>;
}

/** The smallest thing a lifecycle function needs from a client: send one command, read the reply
 * as one of the three RESP top-level shapes the family interprets — a bulk string, a flat array of
 * bulk strings, or an error. `null` is the RESP "nil" reply (a missing key). Failures are the two
 * transport tags: a server error reply, or a socket failure. */
export interface ValkeyExecutor {
  readonly send: (args: ReadonlyArray<string>) => Effect.Effect<ValkeyReply, ValkeyTransportError>;
}

/** The per-read abort, and the idle/`connect` deadline `withValkey` sets on the socket. */
export const DEFAULT_SOCKET_TIMEOUT_MS = 10_000;

const CRLF = '\r\n';

const encodeArgs = (args: ReadonlyArray<string>): string =>
  `*${args.length}${CRLF}${args.map((a) => `$${Buffer.byteLength(a)}${CRLF}${a}`).join(CRLF)}${CRLF}`;

/**
 * The real executor over a `node:net` socket. `socket` is supplied by the caller (which owns
 * connect/close), so `withValkey` can open one socket per operation and close it after.
 * `timeoutMs` bounds each read; the default matches the socket deadline in `connection.ts`.
 */
export const makeSocketExecutor = (
  socket: Socket,
  timeoutMs: number = DEFAULT_SOCKET_TIMEOUT_MS,
): ValkeyExecutor => {
  const inFlight: InFlight = { fail: null };
  let socketFailure: string | undefined;
  const onError = (error: Error) => {
    socketFailure = error.message;
    inFlight.fail?.(error.message);
  };
  socket.on('error', onError);
  return {
    send: (args) => {
      if (socketFailure !== undefined || socket.destroyed) {
        return Effect.fail(new ValkeySocketError({ reason: socketFailure ?? 'socket closed' }));
      }
      const state: ReadBuf = { buf: Buffer.alloc(0), taken: 0 };
      // Command name only. The full argv of `AUTH` / `ACL SETUSER` includes `>password`.
      const command = args[0] ?? 'command';
      try {
        socket.write(encodeArgs(args));
      } catch (cause) {
        return Effect.fail(
          new ValkeySocketError({
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
      // `write` can emit `error` synchronously (a peer RST already in the buffer). The
      // lifetime listener stashes it; failing here beats starting a read nothing will answer.
      if (socketFailure !== undefined || socket.destroyed) {
        return Effect.fail(new ValkeySocketError({ reason: socketFailure ?? 'socket closed' }));
      }
      return readReply(socket, state, command, inFlight, timeoutMs);
    },
  };
};

/**
 * Decode a flat array reply into `Map<string, string | null>` for the `key value key value`
 * shape `CONFIG GET` answers. Null values are preserved; a missing key is `null`, never `''`.
 */
export const arrayPairs = (
  values: ReadonlyArray<string | null>,
): ReadonlyMap<string, string | null> => {
  const out = new Map<string, string | null>();
  for (let i = 0; i + 1 < values.length; i += 2) {
    out.set(values[i] ?? '', values[i + 1] ?? null);
  }
  return out;
};
