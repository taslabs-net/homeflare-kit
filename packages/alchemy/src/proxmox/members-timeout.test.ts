/**
 * `MEMBER_TIMEOUT` bounds one cluster-member attempt — proved directly against `executeOnCluster`
 * with a SHORT injected bound, not against `pveWith`/`runPveWith` with an outer `Effect.timeout`.
 *
 * ⛔ WHY A SEPARATE FILE, NOT MORE CASES IN client.test.ts's EXISTING "transport timeout" TEST:
 *   that test (and distilled-pve.test.ts's twin) wraps the WHOLE call in `Effect.timeout('50
 *   millis')` from the OUTSIDE. That proves a write is never resent once the outer timeout wins
 *   the race — but it proves nothing about whether `executeOnCluster`/`runPveWith` bound a single
 *   attempt THEMSELVES: before this file existed, nothing did, and those tests still passed,
 *   because the outer wrapper always won first. A broken fix here hangs node:test's own per-test
 *   timeout instead of quietly passing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import type { PveTarget } from './credentials.ts';
import { executeOnCluster, resetLastGoodForTest } from './members.ts';

type ServeOptions = {
  fetch(request: Request): Response | Promise<Response>;
  hostname: string;
  port: number;
};
const { Bun } = globalThis as unknown as {
  Bun: { serve(options: ServeOptions): { port: number; stop(closeActive: boolean): void } };
};

const target = (members: readonly string[]): PveTarget => ({
  members,
  mount: 'proxmox-c1-test',
  scheme: 'pve',
});

/** Same remap as client.test.ts: https://member:8006 -> http://127.0.0.1:<port>. Never a live host. */
const remapFetch = (ports: Record<string, number>): typeof fetch =>
  Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const port = ports[url.hostname];
      if (port === undefined) {
        return Promise.reject(Object.assign(new Error('unmapped host'), { code: 'ENOTFOUND' }));
      }
      url.protocol = 'http:';
      url.hostname = '127.0.0.1';
      url.port = String(port);
      return globalThis.fetch(url, init);
    },
    { preconnect: globalThis.fetch.preconnect },
  );

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  ports: Record<string, number>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, remapFetch(ports))),
        ),
      ),
    ),
  );

const counting = (body: unknown) => {
  let hits = 0;
  const server = Bun.serve({
    fetch: () => {
      hits += 1;
      return Response.json({ data: body });
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  return { hits: () => hits, port: server.port, stop: () => server.stop(true) };
};

const hanging = () =>
  Bun.serve({
    fetch: () => new Promise<Response>(() => {}),
    hostname: '127.0.0.1',
    port: 0,
  });

const A = 'pve-a.test';
const B = 'pve-b.test';
const BOUND = '100 millis';

describe('MEMBER_TIMEOUT bounds a single attempt', () => {
  it('fails a hung read over to the next member, within the injected bound', async () => {
    resetLastGoodForTest();
    const hang = hanging();
    const good = counting(['ok']);
    try {
      const started = Date.now();
      const response = await run(
        executeOnCluster(
          target([A, B]),
          'GET',
          'pools',
          (apiBase) => HttpClientRequest.get(`${apiBase}/pools`),
          BOUND,
        ),
        { [A]: hang.port, [B]: good.port },
      );
      assert.equal(response.status, 200);
      assert.equal(good.hits(), 1);
      // ⚠️ Loose on purpose (CI jitter) — the real separation is "did not hang for tens of
      //   seconds", which a regression here would, since node:test's own per-test timeout is the
      //   only thing left to end it.
      assert.ok(Date.now() - started < 5000);
    } finally {
      hang.stop(true);
      good.stop();
    }
  });

  it('fails a hung write outright, never resending it, within the injected bound', async () => {
    resetLastGoodForTest();
    const hang = hanging();
    const backup = counting('UPID:timeout-test');
    try {
      const started = Date.now();
      await run(
        executeOnCluster(
          target([A, B]),
          'PUT',
          'nodes/node-c/network',
          (apiBase) => HttpClientRequest.put(`${apiBase}/nodes/node-c/network`),
          BOUND,
        ).pipe(Effect.flip),
        { [A]: hang.port, [B]: backup.port },
      );
      // ⛔ B must never receive the PUT — a post-connect timeout is not pre-send failover.
      assert.equal(backup.hits(), 0);
      assert.ok(Date.now() - started < 5000);
    } finally {
      hang.stop(true);
      backup.stop();
    }
  });
});
