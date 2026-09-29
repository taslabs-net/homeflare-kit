/**
 * Connect to a Streamable HTTP MCP server with the official SDK client: the transport, the
 * caller's headers on every request, and the WHOLE handshake (`initialize` and the
 * `notifications/initialized` that follows it) bounded in time and interruptible.
 *
 * ⛔ HEADERS ARE CREDENTIALS. They ride `requestInit` to the server and nowhere else: not in an
 *   error, a span or a log (mcp-error.ts). A `Redacted` value is unwrapped only here, at the
 *   moment the transport is built.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import type * as Scope from 'effect/Scope';
import { McpToolkitError, type Redact } from './mcp-error.ts';
import { VERSION } from './version.ts';

/** Header values; a `Redacted` is unwrapped only at the moment the transport is built. */
export type McpHeaders = Readonly<Record<string, string | Redacted.Redacted<string>>>;

export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/**
 * The longest a timer can run: `setTimeout` takes a 32-bit signed delay, and a larger one (like
 * one below 1) is set to 1 ms. Node documents that; Bun does the same (measured, see below).
 */
export const MAX_TIMEOUT_MS: number = 2 ** 31 - 1;

/**
 * ⛔ A timeout that is not a finite number of milliseconds in `(0, MAX_TIMEOUT_MS]` is a
 *   programming error, and dies with a `RangeError` before any request, as `maxRounds` does.
 *   The budget feeds two timers (ours and the SDK's per request), and an out-of-range value made
 *   them disagree: measured 2026-09-29 (review of PR 328) against a healthy local stub,
 *   `Infinity` failed at once ("did not finish within Infinity ms") while `0`, `-1`, `NaN` and
 *   `2 ** 31` each happened to succeed, because the timer clamped to 1 ms and the handshake won
 *   the race. A real handshake takes longer than that 1 ms (not measured remotely), so those
 *   would lose it.
 */
export const validateTimeout = (timeout: number): Effect.Effect<number> =>
  Number.isFinite(timeout) && timeout > 0 && timeout <= MAX_TIMEOUT_MS
    ? Effect.succeed(timeout)
    : Effect.die(
        new RangeError(
          `connectTimeoutMs must be a finite number of milliseconds above 0 and at most ${String(MAX_TIMEOUT_MS)}, got ${String(timeout)}`,
        ),
      );

const plainHeaders = (headers: McpHeaders | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name,
      Redacted.isRedacted(value) ? Redacted.value(value) : value,
    ]),
  );

/**
 * The header values as plain strings, for `redactor` and for nothing else: a value an error
 * message must never repeat is exactly a value the redactor has to know. Kept here so that a
 * `Redacted` is unwrapped in this file only.
 */
export function headerValues(headers: McpHeaders | undefined): string[] {
  return Object.values(plainHeaders(headers));
}

/**
 * ★ THE BUDGET COVERS THE WHOLE HANDSHAKE, NOT ONE REQUEST. SDK 1.31.0 `Client.connect` sends
 *   `initialize` (bounded by its `timeout` option) and then AWAITS a `notifications/initialized`
 *   POST that carries no timeout at all: only the transport's own abort signal ends it. Measured
 *   2026-09-29 (review of PR 328): a server that answered `initialize` and held the second POST
 *   left a caller's `Effect.timeout('2 seconds')` unsettled at 8 s. So a timer here closes the
 *   client when the budget is spent, and `close` aborts the transport's fetch, which is the only
 *   thing that cancels that pending POST.
 * ★ THE CALLER'S `signal` CLOSES IT TOO. It fires when the fiber is interrupted (a seat shutting
 *   down, an `Effect.timeout`), which only means something because `connectAndBuild` runs the handshake
 *   in the `restore`d, interruptible part of its mask: a handshake inside `acquireRelease`'s
 *   uninterruptible acquire would ignore it (that was the first version of this timeout).
 * ⚠️ Whatever the SDK rejects with after the budget is spent (an `AbortError` from the cancelled
 *   fetch, or its own `Request timed out`) is an artefact of the close, so it is replaced by one
 *   message that says what happened.
 */
async function handshake(
  client: Client,
  url: URL,
  headers: McpHeaders | undefined,
  timeout: number,
  signal: AbortSignal,
): Promise<void> {
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: plainHeaders(headers) },
  });
  const budget = new AbortController();
  const stop = AbortSignal.any([signal, budget.signal]);
  const timer = setTimeout(() => budget.abort(), timeout);
  const close = (): void => void client.close().catch(() => undefined);
  stop.addEventListener('abort', close, { once: true });
  try {
    // ⚠️ The SDK's own `sessionId?: string` reads as `string | undefined` against its own
    //   `Transport` under `exactOptionalPropertyTypes` (this repo's baseline), so the two
    //   of its types do not line up here. Upstream's typing, not a wrong argument: the
    //   class IS the transport, and nothing of it reaches this package's declarations.
    await client.connect(transport as Transport, { signal: stop, timeout });
  } catch (error) {
    // A failure AFTER the transport starts (a refused `initialize`) leaves the client holding
    // an open transport: close it here rather than wait for the scope.
    await client.close().catch(() => undefined);
    const spent = budget.signal.aborted;
    const sdkTimeout = error instanceof McpError && error.code === ErrorCode.RequestTimeout;
    throw (spent || sdkTimeout) && !signal.aborted
      ? new Error(`the MCP handshake did not finish within ${String(timeout)} ms`)
      : error;
  } finally {
    clearTimeout(timer);
    stop.removeEventListener('abort', close);
  }
}

/**
 * Connect, handshake and BUILD whatever the caller needs from the client (`build`: for
 * `mcpToolkit`, listing the tools and making the toolkit). The client lives as long as the
 * surrounding `Scope`, and only when ALL of that worked.
 *
 * ★ THE FINALIZER IS REGISTERED LAST: after the handshake AND after `build`. A scoped constructor
 *   that fails must leave nothing in the caller's scope, and this one has been wrong twice:
 *   - it used to register the `Client`'s `close` before the handshake. Each `Client` carries its
 *     own JSON Schema validator (SDK client/index.js), so a seat retrying `mcpToolkit` through a
 *     gateway outage held one per failed attempt until its scope closed: measured 2026-09-29
 *     (review of PR 328), 64.7 MB against 10.6 MB after 3 001 refused attempts in one scope,
 *     about 18 KB each. `handshake` closes the client on every failure, so a refused handshake
 *     has nothing left to release.
 *   - it then registered it right after the handshake, BEFORE the `tools/list` that `build` does,
 *     and that listing can fail too: a JSON-RPC error, a page held past `connectTimeoutMs`, a
 *     caller who interrupts. Measured 2026-09-29 (review of PR 328, later round), a loopback
 *     server that completed the handshake: 20 attempts whose listing errored left 20 finalizers
 *     and 20 open SSE streams in one scope; 10 whose listing was held left 10 finalizers, 10
 *     streams and 10 `tools/list` POSTs still open (the SDK's per-request timeout rejects the
 *     promise and does not abort the fetch). A seat retrying once a second against a slow gateway
 *     is about 3 600 sessions and sockets an hour, held for the life of the seat.
 *   `close` aborts the transport's fetches (the SSE stream and a held POST alike), which is why
 *   closing the client is what releases them.
 * ⚠️ `uninterruptibleMask` keeps the gaps between the steps from being interruption points (a
 *   client opened and never closed); only the handshake and `build` are restored to
 *   interruptible, and each has an `onError` that closes the client when it fails OR is
 *   interrupted, so the SDK's own close-on-abort is not the only line of defence. `onError` runs
 *   uninterruptibly, so the close itself cannot be cut off.
 * ★ THE `seat.mcp.connect` SPAN IS THE HANDSHAKE ONLY, not `build`: it is what a slow or refused
 *   connect looks like in a trace, and the listing is not that.
 */
export const connectAndBuild = <A>(
  url: URL,
  headers: McpHeaders | undefined,
  server: string,
  timeout: number,
  redact: Redact,
  build: (client: Client) => Effect.Effect<A, McpToolkitError>,
): Effect.Effect<A, McpToolkitError, Scope.Scope> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const client = new Client({ name: '@homeflare/seat-runtime', version: VERSION });
      const close = Effect.ignore(Effect.tryPromise(() => client.close()));
      yield* restore(
        Effect.tryPromise({
          try: (signal) => handshake(client, url, headers, timeout, signal),
          catch: (cause) => new McpToolkitError({ operation: 'connect', server, cause, redact }),
        }).pipe(Effect.withSpan('seat.mcp.connect', { attributes: { 'server.address': server } })),
      ).pipe(Effect.onError(() => close));
      const built = yield* restore(build(client)).pipe(Effect.onError(() => close));
      yield* Effect.addFinalizer(() => close);
      return built;
    }),
  );
