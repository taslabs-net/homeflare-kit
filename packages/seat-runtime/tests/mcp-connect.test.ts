/**
 * `mcpToolkit`'s handshake against servers that stall part-way: `connectTimeoutMs` bounds the
 * WHOLE handshake, not only the `initialize` request, and a caller's `Effect.timeout` ends it too.
 *
 * ★ THE SERVER ANSWERS `initialize` AND HOLDS `notifications/initialized`. That is the case the
 *   first version of the timeout missed (review of PR 328): SDK 1.31.0 `Client.connect` awaits
 *   the notification's POST with no timeout of its own, inside an uninterruptible acquire, and
 *   the first test here held only the FIRST request, so it could not see it. The stub is
 *   tests/mcp-wedge.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { McpToolkitError, mcpToolkit } from '../src/index.ts';
import { type Wedge, wedgedServer } from './mcp-wedge.ts';
import { printed } from './printed.ts';

const servers: Wedge[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

/** A server that answers `initialize` and holds `notifications/initialized`. */
function wedgedAfterInitialize(): Wedge {
  const server = wedgedServer('notifications/initialized');
  servers.push(server);
  return server;
}

describe('a handshake that stalls after `initialize` answered', () => {
  test('is cut off at connectTimeoutMs, with a typed error that says the handshake ran out', async () => {
    const server = wedgedAfterInitialize();
    const started = Date.now();
    const error = await Effect.runPromise(
      Effect.scoped(
        mcpToolkit(`${server.url}?token=query-secret`, undefined, { connectTimeoutMs: 300 }),
      ).pipe(
        // The caller's own bound is the backstop: if the budget did not cover this phase, THIS
        // is what would end it, as a TimeoutError and not as an McpToolkitError.
        Effect.timeout('4 seconds'),
        Effect.flip,
      ),
    );
    expect(error).toBeInstanceOf(McpToolkitError);
    expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'connect' });
    expect(error.message).toContain('did not finish within 300 ms');
    expect(`${error.message} ${printed(error)}`).not.toContain('query-secret');
    // The server did take the notification: the test exercised the phase it claims to.
    expect(server.held()).toBe(1);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('is ended by the caller’s Effect.timeout while the budget is still running', async () => {
    const server = wedgedAfterInitialize();
    const started = Date.now();
    // A budget far past the caller's bound: only interruption can end this in time. Before the
    // handshake was interruptible, the caller's timeout sat behind the uninterruptible acquire.
    const outcome = await Effect.runPromise(
      Effect.scoped(mcpToolkit(server.url, undefined, { connectTimeoutMs: 60_000 })).pipe(
        Effect.timeout('300 millis'),
        Effect.result,
      ),
    );
    expect(outcome._tag).toBe('Failure');
    expect(server.held()).toBe(1);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('a server that never answers `initialize` fails with the same message', async () => {
    const blackHole = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      idleTimeout: 0,
      fetch: () => new Promise<Response>(() => undefined),
    });
    try {
      const error = await Effect.runPromise(
        Effect.scoped(
          mcpToolkit(`http://127.0.0.1:${String(blackHole.port)}/mcp`, undefined, {
            connectTimeoutMs: 200,
          }),
        ).pipe(Effect.flip),
      );
      expect(error).toMatchObject({ _tag: 'McpToolkitError', operation: 'connect' });
      expect(error.message).toContain('did not finish within 200 ms');
    } finally {
      void blackHole.stop(true);
    }
  });
});
