/**
 * The RESP wire the `Valkey` family speaks, hand-rolled the same way `postgres/database-sql.ts`
 * hand-rolls its four statements: there is no `@distilled.cloud/valkey` SDK (registry 404, checked
 * 2026-09-29), and `effect@4.0.0-rc.115` ships no Valkey/Redis client, so the family declares a
 * `ValkeyExecutor` seam — the real socket client below, or `fake-valkey.ts` in tests — and every
 * lifecycle function depends only on that small interface, never on `node:net`.
 *
 * ⛔ RESP, NOT A TAG TO VALKEY'S C VERSION. The protocol is line-and-prefix oriented and stable
 *   across Valkey's releases; the commands this family issues (`INFO`, `CONFIG GET`, `ACL LIST`,
 *   `ACL SETUSER`, `PING`) are all long-settled. Nothing here parses a version-specific field.
 * ★ RUNTIME-NEUTRAL. The executor is a function of `node:net` sockets, no Bun API; a Bun-only
 *   consumer would be a regression the postgres family's own `PgClient` avoided.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import type { Socket } from 'node:net';

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

export type ValkeyReply =
  | { readonly kind: 'bulk'; readonly value: string | null }
  | { readonly kind: 'array'; readonly values: ReadonlyArray<string | null> }
  | { readonly kind: 'error'; readonly message: string };

/** A reply that came back as an error line (`-ERR …`). `detail` is the server's own error text;
 * the `message` getter names it without recursing. */
export class ValkeyServerError extends Data.TaggedError('ValkeyServerError')<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

/** A socket-level failure (connection refused, reset, closed mid-reply) — distinct from a
 * protocol-level `ValkeyServerError` so callers can tell "server said no" from "never reached
 * it". */
export class ValkeySocketError extends Data.TaggedError('ValkeySocketError')<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

/** The two transport-level failures every `ValkeyExecutor` can surface, as one union so a
 * caller's declared error channel stays short. */
export type ValkeyTransportError = ValkeyServerError | ValkeySocketError;

const CRLF = '\r\n';

const encodeArgs = (args: ReadonlyArray<string>): string =>
  `*${args.length}${CRLF}${args.map((a) => `$${Buffer.byteLength(a)}${CRLF}${a}`).join(CRLF)}${CRLF}`;

/** A mutable buffer shared between recursive RESP reads so array items consume bytes from the
 * same stream the outer `*` marker was read from. Property assignment is deliberate: it keeps
 * the same object identity, not a local rebound variable, so no byte is lost between items. */
interface ReadBuf {
  buf: Buffer;
}

type ParsedLine = { readonly value: string; readonly drop: number } | undefined;

/** Read one RESP value from the socket, one line/prefix at a time, never buffering beyond what a
 * single reply needs. Recursion depth is bounded by the protocol (arrays nest), not by input size
 * that this family controls.
 *
 * ★ PULL FIRST, THEN LISTEN. A reply the socket delivered whole sits in `state.buf` before this
 * read begins — a nested array issues several sequential reads, and only the first one has a
 * pending `data` event to listen for. Every read therefore checks the buffer it may already hold
 * (and whether the socket already ended) before registering any listener; only a genuinely
 * incomplete prefix waits for the next chunk. */
const readReply = (
  socket: Socket,
  state: ReadBuf,
  command: string,
): Effect.Effect<ValkeyReply, ValkeyTransportError> => {
  /** Resolve once `done(currentBuffer)` returns the bytes to drop from the front of the buffer.
   * On each incoming chunk the buffer grows; when `done` says a complete token is present, the
   * buffer is advanced in-place and the promise resolves. */
  const readUntil = (
    done: (buffer: Buffer) => ParsedLine,
  ): Effect.Effect<string, ValkeySocketError> =>
    Effect.tryPromise({
      try: (signal) =>
        new Promise<string>((resolve, reject) => {
          const settle = (parsed: Exclude<ParsedLine, undefined>) => {
            state.buf = state.buf.subarray(parsed.drop);
            resolve(parsed.value);
          };
          // Pull first: the bytes this read needs may already be in the buffer.
          const immediate = done(state.buf);
          if (immediate !== undefined) {
            settle(immediate);
            return;
          }
          if (socket.readableEnded || socket.destroyed) {
            reject(new ValkeySocketError({ reason: 'socket closed mid-reply' }));
            return;
          }
          const cleanup = () => {
            socket.off('data', onData);
            socket.off('end', onEnd);
            signal.removeEventListener('abort', onAbort);
          };
          const onData = (chunk: Buffer) => {
            state.buf = Buffer.concat([state.buf, chunk]);
            const parsed = done(state.buf);
            if (parsed === undefined) return;
            cleanup();
            settle(parsed);
          };
          const onEnd = () => {
            cleanup();
            reject(new ValkeySocketError({ reason: 'socket closed mid-reply' }));
          };
          const onAbort = () => {
            cleanup();
            reject(new ValkeySocketError({ reason: 'read interrupted' }));
          };
          signal.addEventListener('abort', onAbort);
          socket.on('data', onData);
          socket.on('end', onEnd);
        }),
      catch: (cause) =>
        cause instanceof ValkeySocketError
          ? cause
          : new ValkeySocketError({ reason: String(cause) }),
    });

  const readLine = (): Effect.Effect<string, ValkeySocketError> =>
    readUntil((buffer) => {
      const nl = buffer.indexOf(CRLF);
      return nl === -1
        ? undefined
        : { value: buffer.subarray(0, nl).toString('utf8'), drop: nl + 2 };
    });

  const readBytes = (n: number): Effect.Effect<string, ValkeySocketError> =>
    readUntil((buffer) =>
      buffer.length < n + 2
        ? undefined
        : { value: buffer.subarray(0, n).toString('utf8'), drop: n + 2 },
    );

  return Effect.gen(function* () {
    const line = yield* readLine();
    const prefix = line[0];
    if (prefix === '+') return { kind: 'bulk', value: line.slice(1) } as const;
    if (prefix === '-') {
      return yield* Effect.fail(new ValkeyServerError({ detail: line.slice(1) }));
    }
    if (prefix === '$') {
      const n = Number(line.slice(1));
      if (n === -1) return { kind: 'bulk', value: null } as const;
      return { kind: 'bulk', value: yield* readBytes(n) } as const;
    }
    if (prefix === '*') {
      const n = Number(line.slice(1));
      if (n === -1) return { kind: 'array', values: [] } as const;
      const values: Array<string | null> = [];
      for (let i = 0; i < n; i += 1) {
        const item = yield* readReply(socket, state, command);
        // ⛔ A NESTED ARRAY IS A REPLY THIS FAMILY DOES NOT UNDERSTAND — failing beats
        //   null-flattening it: `values` is typed flat, so a `*1` inside `ACL GETUSER` would
        //   silently lose every flag, password and command rule it carries. The commands this
        //   family reads (`ACL LIST`, `CONFIG GET`) answer flat arrays; a future command that
        //   needs nesting must extend this union with a test, not hope.
        if (item.kind !== 'bulk') {
          return yield* Effect.fail(
            new ValkeyServerError({
              detail: `nested array inside the reply to ${command}: this family reads only flat arrays`,
            }),
          );
        }
        values.push(item.value);
      }
      return { kind: 'array', values } as const;
    }
    if (prefix === ':') return { kind: 'bulk', value: line.slice(1) } as const;
    return yield* Effect.fail(
      new ValkeyServerError({ detail: `unexpected RESP prefix ${prefix}` }),
    );
  });
};

/** The real executor over a `node:net` socket. `socket` is supplied by the caller (which owns
 * connect/close), so `withValkey` can open one socket per operation and close it after. */
export const makeSocketExecutor = (socket: Socket): ValkeyExecutor => ({
  send: (args) => {
    const state: ReadBuf = { buf: Buffer.alloc(0) };
    const command = args.join(' ');
    socket.write(encodeArgs(args));
    return readReply(socket, state, command);
  },
});

/**
 * Decode a flat array reply into `Map<string, string | null>` for the two `key value key value`
 * shapes this family reads — `CONFIG GET` (alternating `key value`), and `INFO` (parsed one line
 * at a time by callers). Null values are preserved; a missing key is `null`, never `''`.
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
