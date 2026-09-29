/**
 * What `mcpToolkit` promises about STARTING UP (review of PR 328, round 2): a failed attempt
 * leaves nothing in the caller's scope, `connectTimeoutMs` is validated, and it bounds the
 * `tools/list` pages read after the handshake too.
 *
 * 🔴 A FAILED ATTEMPT MUST LEAVE THE SCOPE EMPTY. `connect` used to register the `Client`'s
 *   finalizer before the handshake, so a seat that retried `mcpToolkit` through an outage kept
 *   one `Client` (and its JSON Schema validator) per failed attempt until its scope closed:
 *   measured 64.7 MB against 10.6 MB after 3 001 refused attempts in one scope. A scope whose
 *   `state` is still `Empty` has had no finalizer added, which is exactly the claim, and it does
 *   not depend on a heap threshold. A failure AFTER the handshake (the `tools/list`) is the same
 *   claim and its own file: tests/mcp-list-failure.test.ts.
 * ⛔ 127.0.0.1, never Bun's wildcard default (tests/loopback-servers.test.ts scans for it).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Cause, Effect, Exit, Scope } from 'effect';
import { McpToolkitError, mcpToolkit } from '../src/index.ts';
import { MAX_TIMEOUT_MS } from '../src/mcp-connect.ts';
import { startMcpStub } from './mcp-stub.ts';
import { type Wedge, wedgedServer } from './mcp-wedge.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A loopback address that refuses connections: a port that was bound and then released. */
function refusedUrl(): string {
  const listener = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const url = `http://127.0.0.1:${String(listener.port)}/mcp`;
  void listener.stop(true);
  return url;
}

/** A server that answers every request with HTTP 500: the failure comes after the transport starts. */
function brokenUrl(): string {
  const listener = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('down', { status: 500 }),
  });
  cleanups.push(() => listener.stop(true));
  return `http://127.0.0.1:${String(listener.port)}/mcp`;
}

const wedge = (holds: Parameters<typeof wedgedServer>[0]): Wedge => {
  const server = wedgedServer(holds);
  cleanups.push(server.stop);
  return server;
};

describe('a failed connect leaves the caller’s scope empty', () => {
  /** Run `attempts` connects into ONE scope, each allowed to fail, and hand the scope back. */
  async function attemptsInOneScope(attempts: number, makeUrl: () => string, timeoutMs?: number) {
    const scope = Scope.makeUnsafe();
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const outcome = await Effect.runPromise(
        mcpToolkit(makeUrl(), undefined, { connectTimeoutMs: 5000 }).pipe(
          timeoutMs === undefined ? (self) => self : Effect.timeout(timeoutMs),
          Scope.provide(scope),
          Effect.result,
        ),
      );
      expect(outcome._tag).toBe('Failure');
    }
    return scope;
  }

  test('a refused connection', async () => {
    const scope = await attemptsInOneScope(25, refusedUrl);
    expect(scope.state._tag).toBe('Empty');
  });

  test('a server that fails `initialize` after the transport started', async () => {
    const url = brokenUrl();
    const scope = await attemptsInOneScope(25, () => url);
    expect(scope.state._tag).toBe('Empty');
  });

  test('a handshake the caller interrupts', async () => {
    const server = wedge('notifications/initialized');
    const scope = await attemptsInOneScope(8, () => server.url, 200);
    expect(scope.state._tag).toBe('Empty');
    // Every attempt got as far as the notification the server holds, so it was the interruption
    // (not a refusal) that ended each one.
    expect(server.held()).toBe(8);
  });

  test('control: a connect that succeeds does register its close, and the scope closes it', async () => {
    const stub = startMcpStub();
    cleanups.push(stub.stop);
    const scope = Scope.makeUnsafe();
    await Effect.runPromise(mcpToolkit(stub.url).pipe(Scope.provide(scope)));
    expect(scope.state._tag).toBe('Open');
    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(scope.state._tag).toBe('Closed');
  });
});

describe('connectTimeoutMs is validated', () => {
  const defectOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
    Exit.isFailure(exit) ? exit.cause.reasons.find(Cause.isDieReason)?.defect : undefined;

  test.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    MAX_TIMEOUT_MS + 1,
  ])('%p is a RangeError defect before any request', async (connectTimeoutMs) => {
    const stub = startMcpStub();
    cleanups.push(stub.stop);
    const exit = await Effect.runPromiseExit(
      Effect.scoped(mcpToolkit(stub.url, undefined, { connectTimeoutMs })),
    );
    expect(defectOf(exit)).toBeInstanceOf(RangeError);
    expect(String(defectOf(exit))).toContain('connectTimeoutMs');
    expect(stub.seen).toHaveLength(0);
  });

  test('the largest a timer allows, and a fraction of a millisecond, are accepted', async () => {
    const stub = startMcpStub();
    cleanups.push(stub.stop);
    for (const connectTimeoutMs of [MAX_TIMEOUT_MS, 60_000.5]) {
      const mcp = await Effect.runPromise(
        Effect.scoped(mcpToolkit(stub.url, undefined, { connectTimeoutMs })),
      );
      expect(mcp.toolkit).toBeDefined();
    }
  });
});

describe('the startup budget covers the tools/list pages too', () => {
  test('a server that holds `tools/list` fails as a listTools error at connectTimeoutMs', async () => {
    const server = wedge('tools/list');
    const started = Date.now();
    const error = await Effect.runPromise(
      Effect.scoped(mcpToolkit(server.url, undefined, { connectTimeoutMs: 400 })).pipe(
        // The caller's bound is the backstop: without the budget on the page, THIS would end it,
        // as a TimeoutError, and the SDK would still be waiting its 60 s.
        Effect.timeout('5 seconds'),
        Effect.flip,
      ),
    );
    expect(error).toBeInstanceOf(McpToolkitError);
    expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'listTools' });
    expect(server.held()).toBe(1);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
