/**
 * An MCP server on loopback, built with Effect AI's own `McpServer` (the server half of the
 * stack, so the client under test talks to something that was not written to please it):
 * two tools, one that answers and one that fails, and one resource. Every request's headers
 * are recorded, because "the headers you pass are the headers that arrive" is a claim.
 *
 * ★ Seeded from the scout's measured scratch (pair115/mcp.ts, 2026-09-29), which proved the
 *   official client lists and calls tools and reads a resource against this server. One
 *   change: the scout served it through `@effect/platform-bun`; this goes through
 *   `HttpRouter.toWebHandler` and `Bun.serve`, so the package needs no platform-bun and none
 *   of the `@effect/platform-node-shared` override trap that comes with it (README).
 * ⛔ 127.0.0.1, never Bun's wildcard default: tests/loopback-servers.test.ts scans for it.
 */
import { Effect, Layer, Logger, Schema } from 'effect';
import { McpProtocol, McpServer, Tool, Toolkit } from 'effect/unstable/ai';
import { HttpRouter } from 'effect/unstable/http';

export const RESOURCE_URI = 'estate://notes/hello';
export const RESOURCE_TEXT = 'hello resource';
/** ⚠️ Effect's own text for a tool that failed: it does not forward the failure value. */
export const BOOM_TEXT = 'Tool execution failed due to an internal server error.';

const ReadFact = Tool.make('read_fact', {
  description: 'Read a fact',
  parameters: Schema.Struct({ key: Schema.String }),
  success: Schema.String,
});
// ★ A DECLARED FAILURE (`failure` schema, default mode) reaches the wire as a result with
//   `isError: true` — the MCP-spec way to tell a model a tool failed — but with Effect's own
//   generic text, not the failure value. ⚠️ `failureMode: 'return'` does NOT: measured
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
}): McpStub {
  const server = McpServer.layerHttp({
    name: 'seat-runtime-stub',
    version: '0.0.1',
    path: '/mcp',
    protocols: [McpProtocol.v2025_06_18],
  }).pipe(Layer.provide(HttpRouter.layer));
  const registrations = Layer.mergeAll(
    options?.tools === false ? Layer.empty : tools,
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
      const method = (JSON.parse(rpc || '{}') as { method?: string }).method ?? request.method;
      seen.push({ method, headers: Object.fromEntries(request.headers) });
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
