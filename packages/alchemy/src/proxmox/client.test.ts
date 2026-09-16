/**
 * Cluster member failover with fake PVE servers — no live hosts, no credentials. The rule for what
 * counts as pre-send is pinned separately in members.test.ts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { PveError, pveWith } from './client.ts';
import type { PveCredential, PveTarget } from './credentials.ts';
import { orderedMembers, resetLastGoodForTest } from './members.ts';

type ServeOptions = { fetch(request: Request): Response | Promise<Response>; port: number };
const { Bun } = globalThis as unknown as {
  Bun: { serve(options: ServeOptions): { port: number; stop(closeActive: boolean): void } };
};

const CRED: PveCredential = {
  leaseSeconds: 300,
  secret: 'not-a-real-secret',
  tokenId: 'hf-read@pve!fake',
};

const target = (members: readonly string[]): PveTarget => ({
  members,
  mount: 'proxmox-tb4-test',
  scheme: 'pve',
});

/** Remap https://member:8006 to http://127.0.0.1:<port> — wired through FetchHttpClient.Fetch. */
// ⚠️ `typeof fetch` INCLUDES `preconnect` on bun's lib, which no stub implements — the
//   platform fetch carries a property nothing hand-written does. Object.assign puts it
//   back so the stub still satisfies the type it is standing in for.
const remapFetch = (
  ports: Record<string, number>,
  underlying: typeof fetch = globalThis.fetch,
): typeof fetch =>
  Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : String(input);
      const url = new URL(href);
      const port = ports[url.hostname];
      if (port !== undefined) {
        url.protocol = 'http:';
        url.hostname = '127.0.0.1';
        url.port = String(port);
        return underlying(url, init);
      }
      return underlying(input, init);
    },
    { preconnect: globalThis.fetch.preconnect },
  );

const layerFor = (ports: Record<string, number>) =>
  FetchHttpClient.layer.pipe(
    Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, remapFetch(ports))),
  );

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  ports: Record<string, number> = {},
) => Effect.runPromise(effect.pipe(Effect.provide(layerFor(ports))));

/** A fake member that counts its requests and answers `data`. */
const counting = (data: unknown) => {
  let hits = 0;
  const server = Bun.serve({
    fetch: () => {
      hits += 1;
      return Response.json({ data });
    },
    port: 0,
  });
  return { hits: () => hits, port: server.port, stop: () => server.stop(true) };
};

const A = 'pve-a.test';
const B = 'pve-b.test';

describe('cluster member failover', () => {
  it('skips an unresolvable first member and answers from the second', async () => {
    resetLastGoodForTest();
    const up = counting(['ok']);
    try {
      const data = await run(pveWith(target([A, B]), CRED, 'GET', 'pools'), { [B]: up.port });
      assert.deepEqual(data, ['ok']);
    } finally {
      up.stop();
    }
  });

  it('does not fail over on HTTP 500 from the first member', async () => {
    resetLastGoodForTest();
    const bad = Bun.serve({ fetch: () => new Response('fail', { status: 500 }), port: 0 });
    const good = counting([]);
    try {
      const error = await run(pveWith(target([A, B]), CRED, 'GET', 'pools').pipe(Effect.flip), {
        [A]: bad.port,
        [B]: good.port,
      });
      assert.ok(error instanceof PveError);
      assert.equal(error.status, 500);
      assert.equal(good.hits(), 0);
    } finally {
      bad.stop(true);
      good.stop();
    }
  });

  it('tries the last-good member first on the next call', async () => {
    resetLastGoodForTest();
    const serverA = counting(['a']);
    const serverB = counting(['b']);
    try {
      const t = target([A, B]);
      const ports = { [A]: serverA.port, [B]: serverB.port };
      await run(pveWith(t, CRED, 'GET', 'pools'), ports);
      assert.equal(serverA.hits(), 1);
      assert.equal(serverB.hits(), 0);
      assert.deepEqual(orderedMembers(t), [A, B]);
      await run(pveWith(t, CRED, 'GET', 'cluster/status'), ports);
      assert.equal(serverA.hits(), 2);
      assert.equal(serverB.hits(), 0);
    } finally {
      serverA.stop();
      serverB.stop();
    }
  });

  it('does not re-send a write after a transport timeout', async () => {
    resetLastGoodForTest();
    const hang = Bun.serve({ fetch: () => new Promise<Response>(() => {}), port: 0 });
    const backup = counting('UPID:1');
    try {
      await run(
        pveWith(target([A, B]), CRED, 'PUT', 'nodes/n3/network').pipe(
          Effect.timeout('50 millis'),
          Effect.flip,
        ),
        { [A]: hang.port, [B]: backup.port },
      );
      // ⛔ B must never receive the PUT — a post-send timeout is not pre-send failover.
      assert.equal(backup.hits(), 0);
    } finally {
      hang.stop(true);
      backup.stop();
    }
  });

  // ⛔ AND THE OTHER HALF: a write to a member that REFUSES the connection was never sent, so it
  //   must reach the next member. A real Bun refusal on a closed port, not a hand-built error.
  it('fails a write over when the first member refuses the connection', async () => {
    resetLastGoodForTest();
    const backup = counting('UPID:2');
    try {
      // Loopback port 1 is closed: Bun answers ConnectionRefused before a byte is written.
      const data = await run(pveWith(target([A, B]), CRED, 'PUT', 'nodes/n3/network'), {
        [A]: 1,
        [B]: backup.port,
      });
      assert.equal(data, 'UPID:2');
      assert.equal(backup.hits(), 1);
    } finally {
      backup.stop();
    }
  });

  it('names every member when all are down', async () => {
    resetLastGoodForTest();
    const error = await run(pveWith(target([A, B]), CRED, 'GET', 'pools').pipe(Effect.flip));
    assert.ok(error instanceof PveError);
    assert.match(error.message, /all members failed/);
    assert.match(error.message, new RegExp(A));
    assert.match(error.message, new RegExp(B));
  });
});
