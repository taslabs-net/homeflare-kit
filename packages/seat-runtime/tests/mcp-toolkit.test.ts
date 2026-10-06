/**
 * `mcpToolkit` against an Effect `McpServer` on loopback: it lists the server's tools as a
 * toolkit, calls them, hands failures back as results, reads resources, and sends the headers
 * it was given without ever repeating them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Effect, Option, Redacted, Stream } from 'effect';
import { Tool } from 'effect/ai';
import { type McpToolkit, McpToolkitError, mcpToolkit } from '../src/index.ts';
import { BOOM_TEXT, type McpStub, RESOURCE_TEXT, RESOURCE_URI, startMcpStub } from './mcp-stub.ts';
import { printed } from './printed.ts';

let stub: McpStub;
beforeAll(() => {
  stub = startMcpStub();
});
afterAll(() => stub.stop());

/** Connect, run `use`, close. Every test goes through the scope the way a seat would. */
const withMcp = <A, E>(
  use: (mcp: McpToolkit) => Effect.Effect<A, E>,
  url: string = stub.url,
  headers?: Parameters<typeof mcpToolkit>[1],
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(mcpToolkit(url, headers).pipe(Effect.flatMap(use))).pipe(Effect.orDie),
  );

/** One tool call through the toolkit, as the round loop makes it: the last result of the stream. */
const call = (mcp: McpToolkit, name: string, params: unknown) =>
  mcp.toolkit.handle(name, params).pipe(
    Effect.flatMap((stream) => Stream.runLast(stream)),
    Effect.map(Option.getOrThrow),
    Effect.orDie,
  );

describe('tools', () => {
  test('lists the server’s tools, with the server’s own description and JSON schema', async () => {
    const tools = await withMcp((mcp) => Effect.succeed(mcp.toolkit.tools));

    expect(Object.keys(tools).sort()).toEqual(['boom', 'read_fact']);
    const readFact = tools['read_fact'];
    if (readFact === undefined) throw new Error('read_fact was not listed');
    expect(Tool.getDescription(readFact)).toBe('Read a fact');
    const schema = Tool.getJsonSchema(readFact) as {
      type?: string;
      properties?: { key?: { type?: string } };
      required?: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties?.key?.type).toBe('string');
    expect(schema.required).toEqual(['key']);
  });

  test('calls a tool and returns its text', async () => {
    const last = await withMcp((mcp) => call(mcp, 'read_fact', { key: 'codename' }));
    // ★ The text is what the server sent. Measured 2026-10-06: effect 4.0.1's McpServer sends a
    //   string result as is (rc.115 JSON-encoded it, so it arrived quoted).
    expect(last).toMatchObject({ isFailure: false, result: 'fact:codename' });
  });

  test('an isError result comes back to the model as a failed result, not a dead run', async () => {
    const last = await withMcp((mcp) => call(mcp, 'boom', {}));
    expect(last).toMatchObject({ isFailure: true, result: BOOM_TEXT });
  });

  test('a JSON-RPC error (bad arguments) comes back the same way, with the server’s words', async () => {
    const last = await withMcp((mcp) => call(mcp, 'read_fact', { key: 1 }));
    expect(last.isFailure).toBe(true);
    const text = String(last.result);
    expect(text).toContain('MCP call to read_fact failed');
    expect(text).toContain('-32602');
  });

  test('arguments that are not a JSON object are refused before the server is asked', async () => {
    const before = stub.seen.length;
    const last = await withMcp((mcp) => call(mcp, 'read_fact', 'not an object'));
    expect(last.isFailure).toBe(true);
    expect(String(last.result)).toContain('Invalid parameters for tool');
    // Only the handshake and the listing went out: no `tools/call`.
    expect(stub.seen.slice(before).map((r) => r.method)).not.toContain('tools/call');
  });

  test('a tool called after the scope closed fails as a result, it does not hang', async () => {
    const mcp = await Effect.runPromise(Effect.scoped(mcpToolkit(stub.url)));
    // The scope closed on the way out: the transport is gone.
    const last = await Effect.runPromise(call(mcp, 'read_fact', { key: 'x' }));
    expect(last.isFailure).toBe(true);
    expect(String(last.result)).toContain('MCP call to read_fact failed');
  });
});

describe('resources', () => {
  test('lists and reads a resource', async () => {
    const { listed, read } = await withMcp((mcp) =>
      Effect.gen(function* () {
        return { listed: yield* mcp.listResources, read: yield* mcp.readResource(RESOURCE_URI) };
      }),
    );

    expect(listed).toEqual([
      expect.objectContaining({ uri: RESOURCE_URI, name: 'hello', mimeType: 'text/plain' }),
    ]);
    expect(read).toEqual([expect.objectContaining({ uri: RESOURCE_URI, text: RESOURCE_TEXT })]);
  });

  test('an unknown URI fails with McpToolkitError carrying the operation', async () => {
    const error = await withMcp((mcp) => mcp.readResource('estate://nope').pipe(Effect.flip));
    expect(error).toBeInstanceOf(McpToolkitError);
    expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'readResource' });
    expect(error.message).toContain('estate://nope');
  });

  test('a server without the tools capability is not asked for tools, and its resources still work', async () => {
    const resourcesOnly = startMcpStub({ tools: false });
    try {
      const { tools, listed } = await withMcp(
        (mcp) =>
          Effect.gen(function* () {
            return { tools: Object.keys(mcp.toolkit.tools), listed: yield* mcp.listResources };
          }),
        resourcesOnly.url,
      );
      expect(tools).toEqual([]);
      expect(listed).toHaveLength(1);
      expect(resourcesOnly.seen.map((r) => r.method)).not.toContain('tools/list');
    } finally {
      await resourcesOnly.stop();
    }
  });

  test('a server without the resources capability is not asked, and has none', async () => {
    const bare = startMcpStub({ resources: false });
    try {
      const listed = await withMcp((mcp) => mcp.listResources, bare.url);
      expect(listed).toEqual([]);
      expect(bare.seen.map((r) => r.method)).not.toContain('resources/list');
    } finally {
      await bare.stop();
    }
  });
});

describe('headers and errors', () => {
  test('every request carries the headers, and a Redacted one is unwrapped', async () => {
    const before = stub.seen.length;
    await withMcp((mcp) => mcp.listResources, stub.url, {
      'x-seat': 'cf-coding',
      authorization: Redacted.make('Bearer test-value'),
    });
    const requests = stub.seen.slice(before);
    // initialize, initialized, tools/list, and the resources listing.
    expect(requests.length).toBeGreaterThanOrEqual(4);
    for (const request of requests) {
      expect(request.headers['x-seat']).toBe('cf-coding');
      expect(request.headers['authorization']).toBe('Bearer test-value');
    }
  });

  test('a server that is down fails with McpToolkitError, and the message repeats no secret', async () => {
    const down = startMcpStub();
    const url = `${down.url}?token=query-secret`;
    await down.stop();

    const error = await Effect.runPromise(
      Effect.scoped(mcpToolkit(url, { authorization: Redacted.make('header-secret') })).pipe(
        Effect.flip,
      ),
    );
    expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'connect' });
    // ⚠️ The whole error as a log would print it, not just `message`: a refused fetch carries the
    //   full URL in its own `path` field (tests/printed.ts).
    const shown = `${error.message} ${error.server} ${printed(error)}`;
    expect(shown).not.toContain('query-secret');
    expect(shown).not.toContain('header-secret');
    expect(error.server).toBe(down.url);
  });
});

describe('a server that cannot be reached, or will not answer', () => {
  test('a URL that does not parse is a typed error, and the string is not repeated', async () => {
    const error = await Effect.runPromise(
      Effect.scoped(mcpToolkit('not a url?token=parse-secret')).pipe(Effect.flip),
    );
    expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'connect' });
    expect(`${error.message} ${error.server} ${printed(error)}`).not.toContain('parse-secret');
  });

  test('a server that accepts and never answers is cut off at connectTimeoutMs', async () => {
    // A listener that takes the request and holds it: the handshake can only end by timeout.
    const blackHole = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Promise<Response>(() => undefined),
    });
    try {
      const started = Date.now();
      const error = await Effect.runPromise(
        Effect.scoped(
          mcpToolkit(`http://127.0.0.1:${String(blackHole.port)}/mcp`, undefined, {
            connectTimeoutMs: 200,
          }),
        ).pipe(Effect.flip),
      );
      expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'connect' });
      // Well under the SDK's own 60 s default.
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      void blackHole.stop(true);
    }
  });
});
