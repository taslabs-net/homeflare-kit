/**
 * An MCP server that completes the handshake, offers the standalone SSE stream a real one does,
 * and then FAILS or HOLDS `tools/list`, counting what the client leaves open on it. A `Bun.serve`
 * stub rather than the Effect `McpServer` because the point is a listing that goes wrong.
 *
 * ★ WHY IT COUNTS OPEN CONNECTIONS. The claim under test is "a failed `mcpToolkit` leaves nothing
 *   behind", and the caller's `Scope` being empty says so from the client's side only. The server
 *   is the party that pays for a leak: an SSE stream and a held POST stay open until the client
 *   aborts them, and the SDK's per-request timeout rejects a held `tools/list` WITHOUT aborting
 *   its fetch (review of PR 328, later round).
 * ⛔ 127.0.0.1, never Bun's wildcard default (tests/loopback-servers.test.ts scans for it).
 */

/** How `tools/list` goes wrong: a JSON-RPC error answer, or no answer at all. */
export type Listing = 'error' | 'hold';

export type OpenServer = {
  readonly url: string;
  /** What the server has seen: streams and held listings opened, and how many are open NOW. */
  readonly state: () => {
    readonly sessions: number;
    readonly streamsOpened: number;
    readonly streamsOpen: number;
    readonly listingsOpened: number;
    readonly listingsOpen: number;
  };
  readonly stop: () => void;
};

export function openServer(listing: Listing): OpenServer {
  let sessions = 0;
  let streamsOpened = 0;
  let streamsOpen = 0;
  let listingsOpened = 0;
  let listingsOpen = 0;
  const listener = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    // Bun must not drop the held connections for us: the client has to be the one to abort them.
    idleTimeout: 0,
    async fetch(request) {
      if (request.method === 'DELETE') return new Response(null, { status: 200 });
      if (request.method === 'GET') {
        // The standalone SSE stream: open until the client aborts it.
        streamsOpened += 1;
        streamsOpen += 1;
        request.signal.addEventListener('abort', () => void (streamsOpen -= 1), { once: true });
        return new Response(new ReadableStream({ start: () => undefined }), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      const body = (await request.json()) as { id?: number; method: string };
      if (body.method === 'initialize') {
        sessions += 1;
        return Response.json(
          {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'open', version: '0' },
            },
          },
          { headers: { 'mcp-session-id': `session-${String(sessions)}` } },
        );
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body.method === 'tools/list' && listing === 'hold') {
        listingsOpened += 1;
        listingsOpen += 1;
        request.signal.addEventListener('abort', () => void (listingsOpen -= 1), { once: true });
        return new Promise<Response>(() => undefined);
      }
      if (body.method === 'tools/list') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32603, message: 'upstream MCP server unavailable' },
        });
      }
      return new Response(null, { status: 202 });
    },
  });
  return {
    url: `http://127.0.0.1:${String(listener.port)}/mcp`,
    state: () => ({ sessions, streamsOpened, streamsOpen, listingsOpened, listingsOpen }),
    stop: () => void listener.stop(true),
  };
}
