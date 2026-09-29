/**
 * A `mcpToolkit` that fails AFTER the handshake leaves nothing behind: not in the caller's scope
 * and not on the server. tests/mcp-startup.test.ts covers the failures before the handshake ends.
 *
 * 🔴 THE GAP THIS CLOSES (review of PR 328, later round, measured): the client's finalizer was
 *   registered right after the handshake, and `tools/list` ran after it. A listing that answered
 *   a JSON-RPC error, was held past `connectTimeoutMs`, or was interrupted therefore left the
 *   connected `Client` registered and open in the caller's scope. Against a loopback server: 20
 *   errored listings in one scope left 20 finalizers and 20 open SSE streams, and 10 held ones
 *   left 10 finalizers, 10 streams and 10 `tools/list` POSTs still open. A seat retrying
 *   `mcpToolkit` once a second while LiteLLM's aggregated listing is slow opens about 3 600
 *   sessions an hour that way. The changeset, docs/mcp.md and mcp-connect.ts all said the
 *   opposite ("a failed connect leaves nothing in the scope").
 * ★ TWO ASSERTIONS PER CASE, ONE FOR EACH SIDE: the scope's `state` is still `Empty` (no finalizer
 *   was ever added), and the SERVER holds no open stream or listing once the failed attempts are
 *   over (`close` aborts the SDK's fetches; a per-request timeout alone does not).
 * ⛔ 127.0.0.1, never Bun's wildcard default (tests/loopback-servers.test.ts scans for it).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Effect, Scope } from 'effect';
import { McpToolkitError, mcpToolkit } from '../src/index.ts';
import { type Listing, type OpenServer, openServer } from './mcp-open.ts';
import { until } from './stub.ts';

const servers: OpenServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

const serverFor = (listing: Listing): OpenServer => {
  const server = openServer(listing);
  servers.push(server);
  return server;
};

/** `attempts` failed `mcpToolkit` calls into ONE scope; every one must fail, and the errors come back. */
async function attemptsInOneScope(
  url: string,
  attempts: number,
  options?: { interruptMs: number },
) {
  const scope = Scope.makeUnsafe();
  const errors: unknown[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = await Effect.runPromise(
      mcpToolkit(url, undefined, { connectTimeoutMs: 300 }).pipe(
        options === undefined ? (self) => self : Effect.timeout(options.interruptMs),
        Scope.provide(scope),
        Effect.flip,
      ),
    );
    errors.push(outcome);
  }
  return { scope, errors };
}

/** The server's side of the same claim: nothing is left open once the client has let go. */
const serverIsQuiet = (server: OpenServer) =>
  until(
    () => server.state().streamsOpen === 0 && server.state().listingsOpen === 0,
    'the server to hold no open stream or listing',
  );

describe('a `tools/list` that fails after the handshake', () => {
  test('a JSON-RPC error leaves the scope empty and the server with nothing open', async () => {
    const server = serverFor('error');
    const { scope, errors } = await attemptsInOneScope(server.url, 10);

    for (const error of errors) {
      expect(error).toBeInstanceOf(McpToolkitError);
      expect(error).toMatchObject({ operation: 'listTools' });
    }
    expect(scope.state._tag).toBe('Empty');
    // Non-vacuous: every attempt got past the handshake and opened a session (and the stream).
    expect(server.state().sessions).toBe(10);
    expect(server.state().streamsOpened).toBeGreaterThan(0);
    await serverIsQuiet(server);
  });

  test('a listing held past connectTimeoutMs does too, including the POST that was never answered', async () => {
    const server = serverFor('hold');
    const { scope, errors } = await attemptsInOneScope(server.url, 6);

    for (const error of errors) {
      expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'listTools' });
    }
    expect(scope.state._tag).toBe('Empty');
    // ⚠️ The listing POST is the one the SDK's own timeout does not abort.
    expect(server.state().listingsOpened).toBe(6);
    await serverIsQuiet(server);
  });

  test('a caller who interrupts the listing does too', async () => {
    const server = serverFor('hold');
    // The caller's bound is far below the budget, so only interruption can end each attempt.
    const budget = { interruptMs: 150 };
    const { scope } = await attemptsInOneScope(server.url, 6, budget);

    expect(scope.state._tag).toBe('Empty');
    expect(server.state().listingsOpened).toBe(6);
    await serverIsQuiet(server);
  });
});
