/**
 * An MCP server's tools as an Effect AI `Toolkit`, and its resources as two Effects, through
 * the official MCP TypeScript SDK (`Client` over `StreamableHTTPClientTransport`).
 *
 * ★ THE SDK'S CLIENT IS THE CLIENT. Effect AI ships the SERVER half of MCP (`McpServer`,
 *   `McpSchema`); no client (walked down 2026-09-29, docs/plans/2026-09-29-cf-seat-sdk-spike.md
 *   open item 2). Wrapping the official client as dynamic tools is that plan's smallest option,
 *   and the scout measured the pairing: list, call and resource read against an Effect
 *   `McpServer` (pair115/mcp.ts).
 * ★ EACH MCP TOOL IS A `Tool.dynamic` WITH THE SERVER'S OWN JSON SCHEMA (mcp-tool.ts). The schema
 *   goes to the model as the server wrote it, and no Effect Schema is built from its types: the
 *   only client-side check is that the declared `required` arguments are present, and the server
 *   validates the rest and its complaint comes back to the model.
 * ⚠️ A TOOL FAILURE IS THE MODEL'S TO SEE, NOT THE RUN'S TO DIE OF. Every tool is
 *   `failureMode: 'return'`: an `isError` result, a JSON-RPC error (bad arguments, unknown
 *   tool) and a call that never completed all come back to the model as the tool's result, so
 *   it can correct itself or answer without the tool. MCP specifies errors-in-results for
 *   exactly this. Connecting and listing are different: nothing works without them, so they
 *   fail with `McpToolkitError`.
 * ⚠️ THE TOOL LIST IS A SNAPSHOT taken at connect time; a server's `listChanged` notification is
 *   not followed. Reconnect for a fresh list.
 * ⛔ HEADERS ARE CREDENTIALS. They ride `requestInit` to the server and nowhere else: not in an
 *   error, a span or a log (mcp-error.ts). Pass a bearer value as `Redacted` to keep it out of
 *   an accidental print of the argument, as `SeatModel` does with the API key.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import type * as Toolkit from 'effect/unstable/ai/Toolkit';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  type McpHeaders,
  connectAndBuild,
  headerValues,
  validateTimeout,
} from './mcp-connect.ts';
import { McpToolkitError, type Redact, redactor, serverLabel } from './mcp-error.ts';
import { collect } from './mcp-pages.ts';
import { type McpTools, toolset } from './mcp-toolset.ts';

export type { McpTools } from './mcp-toolset.ts';

export type McpResource = {
  readonly uri: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly mimeType?: string | undefined;
};

/** One entry of a resource read: `text` for text, `blob` (base64) for binary. */
export type McpResourceContent = {
  readonly uri: string;
  readonly mimeType?: string | undefined;
  readonly text?: string | undefined;
  readonly blob?: string | undefined;
};

export type McpToolkit = {
  /** Every tool the server listed, with handlers that call it: hand this to `runRounds`. */
  readonly toolkit: Toolkit.WithHandler<McpTools>;
  /** The server's resources; empty when it does not advertise the resources capability. */
  readonly listResources: Effect.Effect<ReadonlyArray<McpResource>, McpToolkitError>;
  /** The contents of one resource; fails with `McpToolkitError` for an unknown URI. */
  readonly readResource: (
    uri: string,
  ) => Effect.Effect<ReadonlyArray<McpResourceContent>, McpToolkitError>;
};

export type McpToolkitOptions = {
  /**
   * The budget for STARTING UP, in milliseconds; default 15 000. A finite number above 0 and at
   * most 2 ** 31 - 1, or a `RangeError` defect before any request (mcp-connect.ts).
   * It covers, each with the full budget:
   *   - the WHOLE handshake: `initialize` and the `notifications/initialized` that follows it;
   *   - every `tools/list` page read after it (a server holding one fails the call as
   *     `McpToolkitError` with `operation: 'listTools'`).
   * ⚠️ It is a budget PER REQUEST, not a total: a server that answers each of its (up to 100)
   *   tool pages in just under the budget can still take that many budgets. Wrap the whole call
   *   in `Effect.timeout` for a total.
   * ⚠️ The SDK bounds only the `initialize` request (its default is 60 s) and leaves the
   *   notification unbounded, so a server that answers `initialize` and then stalls would hold a
   *   seat at startup indefinitely. Here the budget covers both, and the handshake and the
   *   listing are interruptible, so a caller's `Effect.timeout` or a shutdown also ends them, and
   *   either way the client is closed and nothing is left in your scope (mcp-connect.ts).
   * ⚠️ NOT COVERED: `listResources`, `readResource` and tool calls, which are requests you make
   *   after startup and keep the SDK's 60 s default per request. They are interruptible too.
   */
  readonly connectTimeoutMs?: number | undefined;
};

/** The two resource operations against a connected client; neither runs at connect time. */
function resourcesOf(client: Client, server: string, redact: Redact) {
  const listResources = Effect.suspend(() =>
    // ★ A server that does not advertise resources is not asked: a strict one answers
    //   "method not found", and "no resources" is the truthful reading of that.
    client.getServerCapabilities()?.resources === undefined
      ? Effect.succeed<ReadonlyArray<McpResource>>([])
      : collect(
          'listResources',
          server,
          async (cursor, signal) => {
            const page = await client.listResources(cursor === undefined ? undefined : { cursor }, {
              signal,
            });
            return {
              items: page.resources.map((resource): McpResource => ({
                uri: resource.uri,
                name: resource.name,
                description: resource.description,
                mimeType: resource.mimeType,
              })),
              next: page.nextCursor,
            };
          },
          redact,
        ),
  ).pipe(Effect.withSpan('seat.mcp.list_resources', { attributes: { 'server.address': server } }));

  const readResource = (uri: string) =>
    Effect.tryPromise({
      try: async (signal): Promise<ReadonlyArray<McpResourceContent>> => {
        const read = await client.readResource({ uri }, { signal });
        return read.contents.map((entry) => ({
          uri: entry.uri,
          mimeType: entry.mimeType,
          text: 'text' in entry ? entry.text : undefined,
          blob: 'blob' in entry ? entry.blob : undefined,
        }));
      },
      catch: (cause) => new McpToolkitError({ operation: 'readResource', server, cause, redact }),
    }).pipe(
      Effect.withSpan('seat.mcp.read_resource', {
        attributes: { 'mcp.resource': uri, 'server.address': server },
      }),
    );

  return { listResources, readResource };
}

/**
 * Connect to a Streamable HTTP MCP server, list its tools, and return them as a toolkit.
 * The connection lives as long as the surrounding `Scope`.
 *
 * ★ A FAILURE AT ANY POINT LEAVES THE CALLER'S SCOPE EMPTY: the handshake, the `tools/list`
 *   (a JSON-RPC error, a page held past `connectTimeoutMs`) and building the toolkit all run
 *   before the client's finalizer is registered, and each closes the client if it fails or is
 *   interrupted (`connectAndBuild`, mcp-connect.ts). So `Effect.retry` around `mcpToolkit`
 *   accumulates no clients, sessions or sockets.
 */
export function mcpToolkit(
  url: string | URL,
  headers?: McpHeaders,
  options?: McpToolkitOptions,
): Effect.Effect<McpToolkit, McpToolkitError, Scope.Scope> {
  return Effect.gen(function* () {
    const timeout = yield* validateTimeout(options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    // ⚠️ Parsed INSIDE the Effect: `new URL` throws, and a throw at call time would skip the typed
    //   error. The message never repeats the string: a URL is where a token may sit.
    const target = yield* Effect.try({
      try: () => new URL(url),
      catch: () =>
        new McpToolkitError({
          operation: 'connect',
          server: '(unparseable URL)',
          cause: 'the URL did not parse',
        }),
    });
    const server = serverLabel(target);
    // ⛔ Every error and every failure text below goes through this: a server echoes its address,
    //   a query value or a header value, and a fetch failure prints the address, query string and
    //   all (mcp-error.ts).
    const redact = redactor(target, headerValues(headers));

    // The connection lives in the surrounding scope; it is registered there only once the whole
    // toolkit below has been built (see the header of `mcpToolkit`).
    return yield* connectAndBuild(target, headers, server, timeout, redact, (client) =>
      Effect.gen(function* () {
        const toolkit = yield* toolset(client, server, timeout, redact);
        return { toolkit, ...resourcesOf(client, server, redact) };
      }),
    );
  });
}
