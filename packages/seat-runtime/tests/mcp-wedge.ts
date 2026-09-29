/**
 * An MCP server that answers part of a session and takes one request without ever answering
 * it: a worker that wedges between two requests. A `Bun.serve` stub rather than the Effect
 * `McpServer` because the point is a response that never comes.
 *
 * ⛔ 127.0.0.1, never Bun's wildcard default (tests/loopback-servers.test.ts scans for it).
 */

/** The request the stub takes and never answers. */
export type Holds = 'notifications/initialized' | 'tools/list';

export type Wedge = {
  readonly url: string;
  /** How many requests of the held kind the server took and never answered. */
  readonly held: () => number;
  readonly stop: () => void;
};

/**
 * A server whose `initialize` answer is valid, session id included, whose other requests are
 * answered, and whose `holds` request is taken and never answered. `idleTimeout: 0` so Bun does
 * not drop the held connection for us. The caller stops it (see `stopAll`).
 */
export function wedgedServer(holds: Holds): Wedge {
  let held = 0;
  const listener = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = (await request.json()) as { id?: number; method: string };
      if (body.method === holds) {
        held += 1;
        return new Promise<Response>(() => undefined);
      }
      if (body.method === 'initialize') {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'wedge', version: '0' },
            },
          },
          { headers: { 'mcp-session-id': 'session-1' } },
        );
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      return new Response(null, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${String(listener.port)}/mcp`,
    held: () => held,
    stop: () => void listener.stop(true),
  };
}
