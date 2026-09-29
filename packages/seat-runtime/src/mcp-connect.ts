/**
 * Connect to a Streamable HTTP MCP server with the official SDK client: the transport, the
 * caller's headers on every request, and the `initialize` handshake bounded in time.
 *
 * ⛔ HEADERS ARE CREDENTIALS. They ride `requestInit` to the server and nowhere else: not in an
 *   error, a span or a log (mcp-error.ts). A `Redacted` value is unwrapped only here, at the
 *   moment the transport is built.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
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
 * Connect and handshake. ⚠️ A failure AFTER the transport starts (a refused `initialize`)
 * leaves the client holding an open transport, so it is closed here before the error
 * propagates: `acquireRelease` only releases what acquire returned.
 */
export const connect = (
  url: URL,
  headers: McpHeaders | undefined,
  server: string,
  timeout: number,
  redact: Redact,
): Effect.Effect<Client, McpToolkitError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const client = new Client({ name: '@homeflare/seat-runtime', version: VERSION });
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: plainHeaders(headers) },
      });
      try {
        // ⚠️ The SDK's own `sessionId?: string` reads as `string | undefined` against its own
        //   `Transport` under `exactOptionalPropertyTypes` (this repo's baseline), so the two
        //   of its types do not line up here. Upstream's typing, not a wrong argument: the
        //   class IS the transport, and nothing of it reaches this package's declarations.
        await client.connect(transport as Transport, { signal, timeout });
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
      return client;
    },
    catch: (cause) => new McpToolkitError({ operation: 'connect', server, cause, redact }),
  }).pipe(Effect.withSpan('seat.mcp.connect', { attributes: { 'server.address': server } }));
