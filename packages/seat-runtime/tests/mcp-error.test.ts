/**
 * `McpToolkitError` and the address helpers: what a message, a `cause` and a failure text may
 * hold of a server's address. The header of src/mcp-error.ts has the incident behind them.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { Effect, Option, Stream } from 'effect';
import { mcpToolkit } from '../src/index.ts';
import { McpToolkitError, redactor, scrubCause, serverLabel } from '../src/mcp-error.ts';
import { printed } from './printed.ts';

const SECRET = 'QUERYSECRET';
const URL_WITH_SECRET = `http://127.0.0.1:1/mcp?token=${SECRET}`;

describe('serverLabel and redactor', () => {
  const url = new URL(`https://user:pw-secret@mcp.test:8443/v1/mcp?token=${SECRET}#frag-secret`);

  test('the label is origin and path: no credentials, query or fragment', () => {
    expect(serverLabel(url)).toBe('https://mcp.test:8443/v1/mcp');
  });

  test('the whole address in a text becomes the label', () => {
    expect(redactor(url)(`POST to ${url.href} failed`)).toBe(
      'POST to https://mcp.test:8443/v1/mcp failed',
    );
  });

  test('a bare query string, fragment or password is redacted wherever it turns up', () => {
    const text = redactor(url)(`saw ${url.search} and ${url.hash} and pw-secret alone`);
    for (const secret of [SECRET, 'frag-secret', 'pw-secret']) expect(text).not.toContain(secret);
  });

  test('an address with nothing to hide leaves a text untouched', () => {
    expect(redactor(new URL('http://127.0.0.1:1/mcp'))('nothing to see: 1 2 3')).toBe(
      'nothing to see: 1 2 3',
    );
  });
});

describe('scrubCause', () => {
  // What Bun's refused fetch looks like: `path` is the full URL, query string and all.
  const fetchFailure = () =>
    Object.assign(new TypeError('Unable to connect'), {
      code: 'ConnectionRefused',
      errno: 0,
      path: URL_WITH_SECRET,
      data: { echoed: URL_WITH_SECRET },
    });
  const redact = redactor(new URL(URL_WITH_SECRET));

  test('keeps the name, the message and a string or numeric code, and drops every other field', () => {
    const copy = scrubCause(fetchFailure(), redact) as Error & Record<string, unknown>;
    expect(copy).toBeInstanceOf(Error);
    expect(copy.name).toBe('TypeError');
    expect(copy.message).toBe('Unable to connect');
    expect(copy['code']).toBe('ConnectionRefused');
    expect('path' in copy).toBe(false);
    expect('data' in copy).toBe(false);
    expect(printed(copy)).not.toContain(SECRET);
  });

  test('redacts what a message or a stack says', () => {
    const error = new Error(`refused ${URL_WITH_SECRET}`);
    const copy = scrubCause(error, redact) as Error;
    expect(copy.message).toBe('refused http://127.0.0.1:1/mcp');
    expect(copy.stack).not.toContain(SECRET);
  });

  test('follows the cause chain, scrubbed at every link, and ends it', () => {
    let chain: Error = new Error('root');
    for (let depth = 0; depth < 20; depth += 1) {
      chain = new Error(`link ${String(depth)} ${URL_WITH_SECRET}`, { cause: chain });
    }
    const copy = scrubCause(chain, redact) as Error;
    expect(printed(copy)).not.toContain(SECRET);
    let links = 0;
    for (let at: unknown = copy; at instanceof Error; at = at.cause) links += 1;
    expect(links).toBeLessThan(20);
  });

  test('a cause that is not an Error becomes its redacted text', () => {
    expect(scrubCause(`bad ${URL_WITH_SECRET}`, redact)).toBe('bad http://127.0.0.1:1/mcp');
    expect(scrubCause(undefined, redact)).toBe('undefined');
  });
});

describe('McpToolkitError', () => {
  test('never stores the cause it was given, even with no redactor', () => {
    const raw = Object.assign(new TypeError('Unable to connect'), { path: URL_WITH_SECRET });
    const error = new McpToolkitError({ operation: 'connect', server: 'http://x/mcp', cause: raw });
    expect(error.cause).not.toBe(raw);
    expect(printed(error)).not.toContain(SECRET);
  });

  test('a refused connection: nothing in what it prints is the query string', async () => {
    const error = await Effect.runPromise(
      Effect.scoped(mcpToolkit(URL_WITH_SECRET)).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(McpToolkitError);
    expect(printed(error)).not.toContain(SECRET);
    // ★ The diagnosis survives the scrub: the reason and the code are still there.
    expect((error.cause as Error).message.length).toBeGreaterThan(0);
  });
});

/**
 * A server that speaks just enough MCP to be connected to and then answers one method with an
 * HTTP 500 whose body echoes the address it was called at, query string included. The SDK puts
 * that body into its error, so it is the case where a SERVER prints the token back.
 */
const echoServers: Array<ReturnType<typeof Bun.serve>> = [];
afterAll(() => {
  for (const server of echoServers) void server.stop(true);
});

function echoing(failOn: 'initialize' | 'tools/call'): string {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      // The client opens a GET for server-to-client messages after `initialize`; 405 declines it.
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = (await request.json()) as { id?: number; method?: string };
      if (body.method === failOn)
        return new Response(`cannot serve ${request.url}`, { status: 500 });
      if (body.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'echo', version: '0' },
          },
        });
      }
      if (body.method === 'tools/list') {
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] },
        });
      }
      return new Response(null, { status: 202 });
    },
  });
  echoServers.push(server);
  return `http://127.0.0.1:${String(server.port)}/mcp?token=${SECRET}`;
}

describe('a server that echoes its address back', () => {
  test('a failed handshake: the SDK error holds the body, and the token is redacted out of it', async () => {
    const error = await Effect.runPromise(
      Effect.scoped(mcpToolkit(echoing('initialize'))).pipe(Effect.flip),
    );
    expect(error.message).toContain('cannot serve');
    expect(printed(error)).not.toContain(SECRET);
  });

  test('a failed tool call: the text the model reads has the token redacted out of it', async () => {
    const last = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { toolkit } = yield* mcpToolkit(echoing('tools/call'));
          const stream = yield* toolkit.handle('echo', {});
          return Option.getOrThrow(yield* Stream.runLast(stream));
        }),
      ).pipe(Effect.orDie),
    );
    expect(last.isFailure).toBe(true);
    expect(String(last.result)).toContain('cannot serve');
    expect(String(last.result)).not.toContain(SECRET);
  });
});
