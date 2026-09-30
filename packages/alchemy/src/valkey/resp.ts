/**
 * One RESP reply, pulled off the socket this family owns.
 *
 * ⛔ THE SERVER'S `$N` / `*N` IS NOT A BUDGET. `INFO`, `ACL LIST` and `CONFIG GET` are
 *   small. `$2147483647` or `*1000000000` would grow memory or loop in the same process
 *   that holds every other provider (measured 2026-09-30: both reads stayed pending).
 *   Past the cap the read fails `ValkeySocketError` before it waits for the body.
 * ★ THE PER-READ DEADLINE DOES NOT RESET WHEN A BYTE ARRIVES. `socket.setTimeout` is an
 *   idle timer; a peer that dribbles would stretch it. This abort does not.
 */
import * as Effect from 'effect/Effect';
import type { Socket } from 'node:net';
import {
  type ValkeyReply,
  ValkeyServerError,
  ValkeySocketError,
  type ValkeyTransportError,
} from './transport-error.ts';

/** 1 MiB. The three replies this family reads are kilobytes. */
export const MAX_BULK_BYTES = 1_048_576;

/** `ACL LIST` is one element per user; `CONFIG GET` is two per key. */
export const MAX_ARRAY_ITEMS = 10_000;

const CRLF = '\r\n';

/** A mutable buffer shared between recursive RESP reads so array items consume bytes
 * from the same stream the outer `*` marker was read from. */
export interface ReadBuf {
  buf: Buffer;
  /** Bytes already accepted in this reply. A sum of in-cap bulks must not pass the cap either. */
  taken: number;
}

/** The in-flight read, so a lifetime `error` listener can fail it. `fail` is `null` when
 * no read is waiting — `undefined` is not assignable under `exactOptionalPropertyTypes`. */
export interface InFlight {
  fail: ((reason: string) => void) | null;
}

type ParsedLine = { readonly value: string; readonly drop: number } | undefined;

/** `-1` (RESP nil) or a non-negative integer at most `cap`. Anything else is a refusal. */
const boundedCount = (raw: string, cap: number): number | undefined => {
  if (!/^(?:-1|\d+)$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n > cap) return undefined;
  return n;
};

const readUntil = (
  socket: Socket,
  state: ReadBuf,
  inFlight: InFlight,
  timeoutMs: number,
  done: (buffer: Buffer) => ParsedLine,
): Effect.Effect<string, ValkeySocketError> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        let settled = false;
        // Assigned only when this read has to wait. The early path (bytes already buffered)
        // never registers listeners, so they live on one object the finish path can clear.
        const wait: {
          timer?: ReturnType<typeof setTimeout>;
          onData?: (chunk: Buffer) => void;
          onEnd?: () => void;
        } = {};
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          if (wait.timer !== undefined) clearTimeout(wait.timer);
          if (wait.onData !== undefined) socket.off('data', wait.onData);
          if (wait.onEnd !== undefined) socket.off('end', wait.onEnd);
          signal.removeEventListener('abort', onAbort);
          if (inFlight.fail === failRead) inFlight.fail = null;
          fn();
        };
        const failRead = (reason: string) => {
          finish(() => reject(new ValkeySocketError({ reason })));
        };
        const onAbort = () => failRead('read interrupted');
        const settle = (parsed: Exclude<ParsedLine, undefined>) => {
          state.buf = state.buf.subarray(parsed.drop);
          finish(() => resolve(parsed.value));
        };
        // Pull first: the bytes this read needs may already be in the buffer.
        const immediate = done(state.buf);
        if (immediate !== undefined) {
          settle(immediate);
          return;
        }
        if (socket.readableEnded || socket.destroyed) {
          failRead('socket closed mid-reply');
          return;
        }
        wait.onData = (chunk: Buffer) => {
          state.buf = Buffer.concat([state.buf, chunk]);
          // A length line with no CRLF would otherwise buffer until the peer stopped.
          if (state.buf.length > MAX_BULK_BYTES + 64) {
            failRead(`reply exceeded ${String(MAX_BULK_BYTES)} bytes`);
            return;
          }
          const parsed = done(state.buf);
          if (parsed === undefined) return;
          settle(parsed);
        };
        wait.onEnd = () => failRead('socket closed mid-reply');
        wait.timer = setTimeout(() => failRead('socket timed out'), timeoutMs);
        inFlight.fail = failRead;
        signal.addEventListener('abort', onAbort);
        socket.on('data', wait.onData);
        socket.on('end', wait.onEnd);
      }),
    catch: (cause) =>
      cause instanceof ValkeySocketError ? cause : new ValkeySocketError({ reason: String(cause) }),
  });

/**
 * Read one RESP value. Recursion depth is the protocol's nesting, and this family
 * rejects nesting rather than flattening it — see the nested-array branch.
 *
 * ★ PULL FIRST, THEN LISTEN. A reply the socket delivered whole sits in `state.buf`
 *   before this read begins. Only a genuinely incomplete prefix waits for the next chunk.
 */
export const readReply = (
  socket: Socket,
  state: ReadBuf,
  command: string,
  inFlight: InFlight,
  timeoutMs: number,
): Effect.Effect<ValkeyReply, ValkeyTransportError> => {
  const readLine = (): Effect.Effect<string, ValkeySocketError> =>
    readUntil(socket, state, inFlight, timeoutMs, (buffer) => {
      const nl = buffer.indexOf(CRLF);
      return nl === -1
        ? undefined
        : { value: buffer.subarray(0, nl).toString('utf8'), drop: nl + 2 };
    });

  const readBytes = (n: number): Effect.Effect<string, ValkeySocketError> =>
    Effect.gen(function* () {
      if (state.taken + n > MAX_BULK_BYTES) {
        return yield* Effect.fail(
          new ValkeySocketError({
            reason: `reply exceeded ${String(MAX_BULK_BYTES)} bytes`,
          }),
        );
      }
      state.taken += n;
      return yield* readUntil(socket, state, inFlight, timeoutMs, (buffer) =>
        buffer.length < n + 2
          ? undefined
          : { value: buffer.subarray(0, n).toString('utf8'), drop: n + 2 },
      );
    });

  return Effect.gen(function* () {
    const line = yield* readLine();
    const prefix = line[0];
    if (prefix === '+') return { kind: 'bulk', value: line.slice(1) } as const;
    if (prefix === '-') {
      return yield* Effect.fail(new ValkeyServerError({ detail: line.slice(1) }));
    }
    if (prefix === '$') {
      const n = boundedCount(line.slice(1), MAX_BULK_BYTES);
      if (n === undefined) {
        return yield* Effect.fail(
          new ValkeySocketError({
            reason: `bulk length ${line.slice(1)} exceeds ${String(MAX_BULK_BYTES)}`,
          }),
        );
      }
      if (n === -1) return { kind: 'bulk', value: null } as const;
      return { kind: 'bulk', value: yield* readBytes(n) } as const;
    }
    if (prefix === '*') {
      const n = boundedCount(line.slice(1), MAX_ARRAY_ITEMS);
      if (n === undefined) {
        return yield* Effect.fail(
          new ValkeySocketError({
            reason: `array length ${line.slice(1)} exceeds ${String(MAX_ARRAY_ITEMS)}`,
          }),
        );
      }
      if (n === -1) return { kind: 'array', values: [] } as const;
      const values: Array<string | null> = [];
      for (let i = 0; i < n; i += 1) {
        const item = yield* readReply(socket, state, command, inFlight, timeoutMs);
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
