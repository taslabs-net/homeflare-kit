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
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import * as Toolkit from 'effect/unstable/ai/Toolkit';
import { DEFAULT_CONNECT_TIMEOUT_MS, type McpHeaders, connect } from './mcp-connect.ts';
import { McpToolkitError, describeCause, redactor, serverLabel } from './mcp-error.ts';
import { collect } from './mcp-pages.ts';
import { renderResult } from './mcp-render.ts';
import { type McpTool, mcpTool } from './mcp-tool.ts';

export type McpTools = Readonly<Record<string, McpTool>>;

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
   * How long the `initialize` handshake may take. Default 15 000 ms.
   * ⚠️ The SDK's own default is 60 s, and connecting is UNINTERRUPTIBLE (`acquireRelease` runs
   *   acquire uninterruptible), so a server that accepts the connection and never answers would
   *   hold a seat at startup for that minute, whatever `Effect.timeout` the caller wraps around it.
   */
  readonly connectTimeoutMs?: number | undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Connect to a Streamable HTTP MCP server, list its tools, and return them as a toolkit.
 * The connection lives as long as the surrounding `Scope`.
 */
export function mcpToolkit(
  url: string | URL,
  headers?: McpHeaders,
  options?: McpToolkitOptions,
): Effect.Effect<McpToolkit, McpToolkitError, Scope.Scope> {
  return Effect.gen(function* () {
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
    //   and a fetch failure prints it, query string and all (mcp-error.ts).
    const redact = redactor(target);
    const readFailure = (cause: unknown) =>
      new McpToolkitError({ operation: 'readResource', server, cause, redact });

    const client = yield* Effect.acquireRelease(
      connect(
        target,
        headers,
        server,
        options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        redact,
      ),
      (open) => Effect.ignore(Effect.tryPromise(() => open.close())),
    );

    // ★ A server that does not advertise tools is not asked for them: a resources-only server
    //   answers `tools/list` with "method not found", and one such server would otherwise make
    //   the whole connection unusable for its resources.
    const listed =
      client.getServerCapabilities()?.tools === undefined
        ? []
        : yield* collect(
            'listTools',
            server,
            async (cursor, signal) => {
              const page = await client.listTools(cursor === undefined ? undefined : { cursor }, {
                signal,
              });
              return { items: page.tools, next: page.nextCursor };
            },
            redact,
          );
    const tools = listed.map((tool) =>
      mcpTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }),
    );

    /** Everything the model can do wrong or the server can refuse comes back as a string. */
    const call = (name: string) => (params: unknown) =>
      Effect.gen(function* () {
        // The Toolkit's decode has already rejected a non-object (mcp-tool.ts), so this is the
        // type guard the `unknown` argument needs and not a second line of defence.
        if (!isRecord(params)) {
          return yield* Effect.fail(`${name}: the arguments must be a JSON object`);
        }
        const result = yield* Effect.tryPromise({
          try: (signal) => client.callTool({ name, arguments: params }, undefined, { signal }),
          catch: (cause) => `MCP call to ${name} failed: ${redact(describeCause(cause))}`,
        });
        const text = renderResult(result);
        return result.isError === true ? yield* Effect.fail(text) : text;
      }).pipe(
        Effect.withSpan('seat.mcp.call_tool', {
          attributes: { 'mcp.tool': name, 'server.address': server },
        }),
      );

    const definition = Toolkit.make(...tools);
    const handlers = Object.fromEntries(tools.map((tool) => [tool.name, call(tool.name)]));
    const context = yield* definition.toHandlers(handlers);
    const toolkit = yield* definition.pipe(Effect.provideContext(context));

    const listResources = Effect.suspend(() =>
      // ★ A server that does not advertise resources is not asked: a strict one answers
      //   "method not found", and "no resources" is the truthful reading of that.
      client.getServerCapabilities()?.resources === undefined
        ? Effect.succeed<ReadonlyArray<McpResource>>([])
        : collect(
            'listResources',
            server,
            async (cursor, signal) => {
              const page = await client.listResources(
                cursor === undefined ? undefined : { cursor },
                { signal },
              );
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
    ).pipe(
      Effect.withSpan('seat.mcp.list_resources', { attributes: { 'server.address': server } }),
    );

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
        catch: readFailure,
      }).pipe(
        Effect.withSpan('seat.mcp.read_resource', {
          attributes: { 'mcp.resource': uri, 'server.address': server },
        }),
      );

    return { toolkit, listResources, readResource };
  });
}
