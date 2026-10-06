/**
 * An MCP server on loopback, built with Effect AI's own `McpServer` (the server half of the
 * stack, so the client under test talks to something that was not written to please it):
 * two tools, one that answers and one that fails, and one resource. Every request's headers
 * are recorded, because "the headers you pass are the headers that arrive" is a claim, and so
 * are a tool call's arguments, because what the server RECEIVES is the only honest answer to
 * "did the argument survive the model, compat and the toolkit".
 *
 * ★ Seeded from the scout's measured scratch (pair115/mcp.ts, 2026-09-29), which proved the
 *   official client lists and calls tools and reads a resource against this server. One
 *   change: the scout served it through `@effect/platform-bun`; this goes through
 *   `HttpRouter.toWebHandler` and `Bun.serve`, so the package needs no platform-bun and none
 *   of the `@effect/platform-node-shared` override trap that comes with it (README).
 * ⛔ 127.0.0.1, never Bun's wildcard default: tests/loopback-servers.test.ts scans for it.
 */
import { Effect, Layer, Logger, Schema } from 'effect';
import { McpProtocol, McpServer, Tool, Toolkit } from 'effect/ai';
import { HttpRouter } from 'effect/http';

export const RESOURCE_URI = 'estate://notes/hello';
export const RESOURCE_TEXT = 'hello resource';
/**
 * ⚠️ Measured 2026-10-06 on effect 4.0.1: a declared failure reaches the wire as the
 * JSON-encoded failure value (rc.115 sent a generic "Tool execution failed" text instead).
 */
export const BOOM_TEXT = '"the fact store is down"';

const ReadFact = Tool.make('read_fact', {
  description: 'Read a fact',
  parameters: Schema.Struct({ key: Schema.String }),
  success: Schema.String,
});
// ★ A DECLARED FAILURE (`failure` schema, default mode) reaches the wire as a result with
//   `isError: true` — the MCP-spec way to tell a model a tool failed — carrying the
//   JSON-encoded failure value on effect 4.0.1 (rc.115: a generic text, not the value). ⚠️ `failureMode: 'return'` does NOT: measured
//   2026-09-29, the server sends that as an ordinary success (`isError: false`) whose text is
//   the failure value, so it could not exercise the client's error path.
const Boom = Tool.make('boom', {
  description: 'Always fails',
  success: Schema.String,
  failure: Schema.String,
});
const toolkit = Toolkit.make(ReadFact, Boom);

const tools = McpServer.toolkit(toolkit).pipe(
  Layer.provide(
    toolkit.toLayer({
      read_fact: ({ key }) => Effect.succeed(`fact:${key}`),
      boom: () => Effect.fail('the fact store is down'),
    }),
  ),
);
// ★ An OPTIONAL, NULLABLE argument: `null` means "unassign" and an omitted key means "leave it",
//   the shape where dropping a `null` is a silent wrong write. Only registered on request, so
//   the default tool list stays the two above.
const UpdateIssue = Tool.make('update_issue', {
  description: 'Update an issue',
  parameters: Schema.Struct({
    id: Schema.String,
    assignee: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  success: Schema.String,
});
const issueToolkit = Toolkit.make(UpdateIssue);
const issueTools = McpServer.toolkit(issueToolkit).pipe(
  Layer.provide(
    issueToolkit.toLayer({ update_issue: ({ id }) => Effect.succeed(`updated:${id}`) }),
  ),
);
const resource = McpServer.resource({
  uri: RESOURCE_URI,
  name: 'hello',
  mimeType: 'text/plain',
  content: Effect.succeed(RESOURCE_TEXT),
});

export type McpStub = {
  /** `http://127.0.0.1:<port>/mcp` */
  readonly url: string;
  /** Every request the stub has seen: the JSON-RPC method (the HTTP verb for a GET) and headers. */
  readonly seen: Array<{
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    /** A `tools/call`'s `arguments` as they crossed the wire; undefined for every other request. */
    readonly arguments?: unknown;
  }>;
  readonly stop: () => Promise<void>;
};

/**
 * ⚠️ `protocols` names ONE dated revision (the scout used 2025-06-18) and the client's
 *   negotiation must land on it; a client asking for a revision the server lacks gets a 400.
 */
export function startMcpStub(options?: {
  readonly resources?: boolean;
  readonly tools?: boolean;
  /** Also serve `update_issue`, the optional-nullable-argument tool. */
  readonly issues?: boolean;
}): McpStub {
  const server = McpServer.layerHttp({
    name: 'seat-runtime-stub',
    version: '0.0.1',
    path: '/mcp',
    protocols: [McpProtocol.v2025_06_18],
  }).pipe(Layer.provide(HttpRouter.layer));
  const registrations = Layer.mergeAll(
    options?.tools === false ? Layer.empty : tools,
    options?.issues === true ? issueTools : Layer.empty,
    options?.resources === false ? Layer.empty : resource,
  );
  // The failing tools are deliberate, and the server logs each one as an ERROR with a stack.
  const app = registrations.pipe(Layer.provideMerge(server), Layer.provide(Logger.layer([])));
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });
  const seen: McpStub['seen'] = [];
  const listener = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const rpc = request.method === 'POST' ? await request.clone().text() : '';
      const message = JSON.parse(rpc || '{}') as {
        method?: string;
        params?: { arguments?: unknown };
      };
      seen.push({
        method: message.method ?? request.method,
        headers: Object.fromEntries(request.headers),
        arguments: message.method === 'tools/call' ? message.params?.arguments : undefined,
      });
      return web.handler(request);
    },
  });
  return {
    url: `http://127.0.0.1:${String(listener.port)}/mcp`,
    seen,
    stop: async () => {
      void listener.stop(true);
      await web.dispose();
    },
  };
}
