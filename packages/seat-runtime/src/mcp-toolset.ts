/**
 * An MCP server's tools as a ready-to-run Effect AI toolkit: list them (bounded by the startup
 * budget), wrap each as a `Tool.dynamic` (mcp-tool.ts), and give each a handler that calls the
 * server. Split from mcp-toolkit.ts so that `connectAndBuild` can run all of this BEFORE the
 * client's finalizer is registered (mcp-connect.ts): listing can fail, and a failed listing must
 * leave nothing in the caller's scope.
 *
 * ⚠️ A TOOL FAILURE IS THE MODEL'S TO SEE, NOT THE RUN'S TO DIE OF (see mcp-toolkit.ts). Every
 *   failure below comes back as a string.
 * ⛔ A FAILURE'S TEXT IS REDACTED, A SUCCESS'S IS NOT. What the model reads for an `isError`
 *   result, a JSON-RPC error or a dropped call goes through `redact`: a server that rejects a
 *   credential typically prints it ("bad credential Bearer ..."), and that text goes on to a
 *   cloud model. Measured 2026-09-29 (review of PR 328, later round): an `isError` result that
 *   echoed a query value and a bearer token delivered both to the model, while the same echo in
 *   an `McpToolkitError` was already redacted. A SUCCESSFUL result is the tool's payload and is
 *   delivered verbatim: rewriting it would corrupt legitimate data that happens to contain a
 *   value, and a server that returns a credential as data is not a failure this can tell apart.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as Effect from 'effect/Effect';
import * as Toolkit from 'effect/ai/Toolkit';
import { type McpToolkitError, type Redact, describeCause } from './mcp-error.ts';
import { collect } from './mcp-pages.ts';
import { renderResult } from './mcp-render.ts';
import { type McpTool, mcpTool } from './mcp-tool.ts';

export type McpTools = Readonly<Record<string, McpTool>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Everything the model can do wrong or the server can refuse comes back as a string. */
const call = (client: Client, server: string, redact: Redact, name: string) => (params: unknown) =>
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
    // ⛔ Only a FAILURE's text is redacted: see the header.
    return result.isError === true ? yield* Effect.fail(redact(text)) : text;
  }).pipe(
    Effect.withSpan('seat.mcp.call_tool', {
      attributes: { 'mcp.tool': name, 'server.address': server },
    }),
  );

/**
 * List the server's tools and return them as a toolkit with handlers.
 * ★ A server that does not advertise tools is not asked for them: a resources-only server
 *   answers `tools/list` with "method not found", and one such server would otherwise make the
 *   whole connection unusable for its resources.
 * ★ `timeout` is the startup budget: without it the SDK waits its 60 s per page.
 */
export const toolset = (
  client: Client,
  server: string,
  timeout: number,
  redact: Redact,
): Effect.Effect<Toolkit.WithHandler<McpTools>, McpToolkitError> =>
  Effect.gen(function* () {
    const listed =
      client.getServerCapabilities()?.tools === undefined
        ? []
        : yield* collect(
            'listTools',
            server,
            async (cursor, signal) => {
              const page = await client.listTools(cursor === undefined ? undefined : { cursor }, {
                signal,
                timeout,
              });
              return { items: page.tools, next: page.nextCursor };
            },
            redact,
          );
    const tools = listed.map((tool) =>
      mcpTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }),
    );
    const definition = Toolkit.make(...tools);
    const handlers = Object.fromEntries(
      tools.map((tool) => [tool.name, call(client, server, redact, tool.name)]),
    );
    const context = yield* definition.toHandlers(handlers);
    return yield* definition.pipe(Effect.provideContext(context));
  });
