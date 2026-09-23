/**
 * 🔴 THE INCIDENT THIS PREVENTS. A 429 that is not waited out properly becomes a retry
 *   storm, and a storm escalates from one throttled ROUTE to a throttled TOKEN. Where a
 *   token is shared — a Discord bot and its MCP server on one credential — the storm
 *   takes down the thing that was not even failing.
 */
import { describe, expect, test } from 'bun:test';
import { client } from '../src/http.ts';
import { MAX_RETRY_WAIT_MS, rateLimitAware, retryAfterMs } from '../src/rate-limit.ts';

describe('retryAfterMs', () => {
  test('reads fractional seconds — the whole point of the header', () => {
    expect(retryAfterMs({ get: (n) => (n === 'x-ratelimit-reset-after' ? '0.153' : null) })).toBe(
      153,
    );
  });

  test('prefers x-ratelimit-reset-after over retry-after when both appear', () => {
    // ⚠️ Rounding 0.15s up to 1s wastes throughput on every throttled call.
    const headers = {
      get: (n: string) =>
        n === 'x-ratelimit-reset-after' ? '0.15' : n === 'retry-after' ? '1' : null,
    };

    expect(retryAfterMs(headers)).toBe(150);
  });

  test('caps the wait — an uncapped sleep reads as a hang', () => {
    expect(retryAfterMs({ get: () => '3600' })).toBe(MAX_RETRY_WAIT_MS);
  });

  test('returns null when the server said nothing, so ky uses its own backoff', () => {
    expect(retryAfterMs({ get: () => null })).toBeNull();
  });
});

describe('rateLimitAware', () => {
  test('honours x-ratelimit-reset-after, which ky alone ignores', async () => {
    // ⛔ MEASURED AGAINST ky 2.1.0, 2026-09-15: with this header and no hook, ky waited
    //   303ms — its own backoff — rather than the 1s the server asked for.
    let hits = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        hits += 1;
        return hits === 1
          ? new Response('slow', { status: 429, headers: { 'x-ratelimit-reset-after': '0.4' } })
          : new Response('ok');
      },
    });

    const started = Date.now();
    const body = await client(`http://127.0.0.1:${server.port}`, rateLimitAware).get('/').text();
    const elapsed = Date.now() - started;
    server.stop();

    expect(body).toBe('ok');
    expect(hits).toBe(2);
    // The server asked for 400ms; ky's unaided backoff would be ~300ms.
    expect(elapsed).toBeGreaterThanOrEqual(400);
  });

  test('leaves plain retry-after to ky, so one 429 never sleeps twice', async () => {
    let hits = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        hits += 1;
        return hits === 1
          ? new Response('slow', { status: 429, headers: { 'retry-after': '1' } })
          : new Response('ok');
      },
    });

    const started = Date.now();
    await client(`http://127.0.0.1:${server.port}`, rateLimitAware).get('/').text();
    const elapsed = Date.now() - started;
    server.stop();

    // ~1s if only ky slept; ~2s if the hook slept as well.
    expect(elapsed).toBeLessThan(1800);
  });
});
