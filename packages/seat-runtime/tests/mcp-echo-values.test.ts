/**
 * A server that echoes a VALUE the caller sent: a query value on its own, or a header value on
 * its own, not the address (which tests/mcp-error.test.ts covers).
 *
 * 🔴 THE GAP THIS CLOSES (review of PR 328, round 2, measured): `redactor` took out the query
 *   STRING, the fragment and the password, so a server answering "rejected key QVALUE and
 *   Bearer HVALUE" put both values into `McpToolkitError.message`, and a failed tool call put
 *   them into the text the model reads, while the changeset claimed no header or query string
 *   ever reached a message. The stub below builds its body from what it RECEIVED, so the echo is
 *   the real one and not a string the test typed twice.
 * ⛔ 127.0.0.1, never Bun's wildcard default (tests/loopback-servers.test.ts scans for it).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { Effect, Option, Redacted, Stream } from 'effect';
import { mcpToolkit } from '../src/index.ts';
import { headerValues } from '../src/mcp-connect.ts';
import { MIN_SECRET_LENGTH, redactor } from '../src/mcp-error.ts';
import { printed } from './printed.ts';

const QUERY = 'QVALUE-9f3a71';
const BEARER = 'HVALUE-42c8d0';
const PLAIN = 'plain-value-77b1e5';
const ALL = [QUERY, BEARER, PLAIN];

const listeners: Array<ReturnType<typeof Bun.serve>> = [];
afterAll(() => {
  for (const listener of listeners) void listener.stop(true);
});

/** What the server saw of the caller's secrets, printed back in three shapes. */
function echoOf(request: Request): string {
  const auth = request.headers.get('authorization') ?? '';
  const key = request.headers.get('x-api-key') ?? '';
  const query = new URL(request.url).searchParams.get('key') ?? '';
  // whole header, the credential alone, a bare query value, a bare header value
  return `rejected key ${query}; bad credential ${auth}; token ${auth.split(' ').at(-1) ?? ''}; api ${key}`;
}

function server(failOn: 'initialize' | 'tools/call'): string {
  const listener = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = (await request.json()) as { id?: number; method?: string };
      if (body.method === failOn) return new Response(echoOf(request), { status: 401 });
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
  listeners.push(listener);
  return `http://127.0.0.1:${String(listener.port)}/mcp?key=${QUERY}`;
}

const headers = {
  authorization: Redacted.make(`Bearer ${BEARER}`),
  'x-api-key': PLAIN,
};

const leaks = (text: string): string[] => ALL.filter((secret) => text.includes(secret));

describe('a server that echoes a query value or a header value on its own', () => {
  test('a failed handshake: the message and everything printed hold none of them', async () => {
    const error = await Effect.runPromise(
      Effect.scoped(mcpToolkit(server('initialize'), headers)).pipe(Effect.flip),
    );
    // ★ The diagnosis survives: what the server said is still there, with the values gone.
    expect(error.message).toContain('rejected key');
    expect(error.message).toContain('[redacted]');
    expect(leaks(`${error.message}\n${printed(error)}`)).toEqual([]);
  });

  test('a failed tool call: the text the model reads holds none of them', async () => {
    const last = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { toolkit } = yield* mcpToolkit(server('tools/call'), headers);
          const stream = yield* toolkit.handle('echo', {});
          return Option.getOrThrow(yield* Stream.runLast(stream));
        }),
      ).pipe(Effect.orDie),
    );
    expect(last.isFailure).toBe(true);
    expect(String(last.result)).toContain('rejected key');
    expect(leaks(String(last.result))).toEqual([]);
  });
});

describe('redactor with header values', () => {
  const url = new URL('https://mcp.test/mcp?key=a%20b%2Fsecret-1&short=1');

  test('a Redacted header value is unwrapped for it, and only there', () => {
    expect(headerValues({ a: Redacted.make('one-value'), b: 'two-value' })).toEqual([
      'one-value',
      'two-value',
    ]);
  });

  test('a scheme header is redacted whole and by its credential; the scheme word stays', () => {
    const redact = redactor(url, ['Bearer abc-1234567']);
    expect(redact('sent Bearer abc-1234567, saw abc-1234567, and Bearer alone')).toBe(
      'sent [redacted], saw [redacted], and Bearer alone',
    );
  });

  test('a query value is redacted as written and as decoded', () => {
    const redact = redactor(url);
    expect(redact('raw a%20b%2Fsecret-1 and decoded a b/secret-1')).toBe(
      'raw [redacted] and decoded [redacted]',
    );
  });

  test(`a value under ${String(MIN_SECRET_LENGTH)} characters is left alone, so a message stays legible`, () => {
    const redact = redactor(url, ['true']);
    expect(redact('debug true, short 1, HTTP 401')).toBe('debug true, short 1, HTTP 401');
  });

  test('the longer value goes first, so a value inside another does not split it', () => {
    const redact = redactor(url, ['secret-token-value', 'token-value']);
    expect(redact('saw secret-token-value')).toBe('saw [redacted]');
  });
});
