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

const plainHeaders = (headers: McpHeaders | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name,
      Redacted.isRedacted(value) ? Redacted.value(value) : value,
    ]),
  );

/**
 * ★ THE BUDGET COVERS THE WHOLE HANDSHAKE, NOT ONE REQUEST. SDK 1.31.0 `Client.connect` sends
 *   `initialize` (bounded by its `timeout` option) and then AWAITS a `notifications/initialized`
 *   POST that carries no timeout at all: only the transport's own abort signal ends it. Measured
 *   2026-09-29 (review of PR 328): a server that answered `initialize` and held the second POST
 *   left a caller's `Effect.timeout('2 seconds')` unsettled at 8 s. So a timer here closes the
 *   client when the budget is spent, and `close` aborts the transport's fetch, which is the only
 *   thing that cancels that pending POST.
 * ★ THE CALLER'S `signal` CLOSES IT TOO. It fires when the fiber is interrupted (a seat shutting
 *   down, an `Effect.timeout`), which only means something because the handshake is NOT inside
 *   `acquireRelease`'s uninterruptible acquire: that acquire holds the `Client` object and
 *   nothing on the network.
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
 * Connect and handshake; the client lives as long as the surrounding `Scope`.
 * ⚠️ The scope holds only the `Client` (a constructor, no I/O), so the handshake after it is
 * interruptible and bounded (`handshake`); a failed handshake has already closed the client
 * and the finalizer's `close` is then a no-op.
 */
export const connect = (
  url: URL,
  headers: McpHeaders | undefined,
  server: string,
  timeout: number,
  redact: Redact,
): Effect.Effect<Client, McpToolkitError, Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new Client({ name: '@homeflare/seat-runtime', version: VERSION })),
      (open) => Effect.ignore(Effect.tryPromise(() => open.close())),
    );
    yield* Effect.tryPromise({
      try: (signal) => handshake(client, url, headers, timeout, signal),
      catch: (cause) => new McpToolkitError({ operation: 'connect', server, cause, redact }),
    });
    return client;
  }).pipe(Effect.withSpan('seat.mcp.connect', { attributes: { 'server.address': server } }));
