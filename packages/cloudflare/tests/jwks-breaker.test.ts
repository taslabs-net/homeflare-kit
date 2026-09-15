/**
 * 🔴 THE AMPLIFICATION THIS PREVENTS, measured on jose 6.2.12: five verifications of a
 *   well-formed token against a 404ing certs endpoint produced FIVE outbound fetches, and
 *   no combination of cacheMaxAge or cooldownDuration changed the count. A Cloudflare
 *   Access outage would turn every inbound request into an outbound one.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { breakered, resetBreaker } from '../src/jwks-breaker.ts';

const OPTS = {
  headers: new Headers(),
  method: 'GET',
  redirect: 'manual',
  signal: AbortSignal.timeout(5_000),
} as const;

beforeEach(() => {
  resetBreaker();
});

describe('breakered', () => {
  test('latches a failing URL closed instead of refetching per call', async () => {
    let fetches = 0;
    const fetcher = breakered(async () => {
      fetches += 1;
      return new Response('down', { status: 404 });
    });

    for (let i = 0; i < 5; i += 1) {
      await fetcher('https://team.example/certs', OPTS).catch(() => undefined);
    }

    // Without the breaker this is 5 — one per call, indefinitely.
    expect(fetches).toBe(1);
  });

  test('rethrows the ORIGINAL error, not a generic "circuit open"', async () => {
    const fetcher = breakered(async () => {
      throw new Error('ECONNREFUSED 10.0.0.1:443');
    });

    await fetcher('https://team.example/certs', OPTS).catch(() => undefined);
    // ⚠️ The first failure says whether this was a 404, TLS or a timeout — which is what
    //   an operator needs. A generic message hides the actual fault.
    const second = fetcher('https://team.example/certs', OPTS);

    await expect(second).rejects.toThrow('ECONNREFUSED');
  });

  test('retries once the cooldown has passed', async () => {
    let fetches = 0;
    const fetcher = breakered(async () => {
      fetches += 1;
      return new Response('down', { status: 502 });
    }, 40);

    await fetcher('https://team.example/certs', OPTS).catch(() => undefined);
    await Bun.sleep(60);
    await fetcher('https://team.example/certs', OPTS).catch(() => undefined);

    // ⛔ A latch that never reopens is an outage of its own.
    expect(fetches).toBe(2);
  });

  test('a recovered endpoint clears the latch immediately', async () => {
    let fetches = 0;
    let healthy = false;
    const fetcher = breakered(async () => {
      fetches += 1;
      return healthy ? Response.json({ keys: [] }) : new Response('down', { status: 404 });
    }, 10);

    await fetcher('https://team.example/certs', OPTS).catch(() => undefined);
    healthy = true;
    await Bun.sleep(20);
    await fetcher('https://team.example/certs', OPTS);
    await fetcher('https://team.example/certs', OPTS);

    // 1 failure + 1 recovery + 1 normal call: no latch left behind.
    expect(fetches).toBe(3);
  });

  test('latches per URL, so one bad endpoint cannot block another', async () => {
    let good = 0;
    const fetcher = breakered(async (url) => {
      if (url.includes('bad')) return new Response('down', { status: 404 });
      good += 1;
      return Response.json({ keys: [] });
    });

    await fetcher('https://bad.example/certs', OPTS).catch(() => undefined);
    await fetcher('https://bad.example/certs', OPTS).catch(() => undefined);
    await fetcher('https://good.example/certs', OPTS);

    expect(good).toBe(1);
  });

  test('never caches a Response, which workerd forbids across requests', async () => {
    // ⛔ A Response and its body belong to the IoContext of the request that created them.
    //   Caching one would throw "Cannot perform I/O on behalf of a different request" and
    //   turn a VALID token into a 401 — worse than the amplification it would fix.
    const source = await Bun.file(new URL('../src/jwks-breaker.ts', import.meta.url)).text();
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toContain('failures.set(url, { at: Date.now(), response');
    expect(code).toContain('at: number; readonly error: Error');
  });
});
