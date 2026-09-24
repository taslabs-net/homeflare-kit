/**
 * Cluster member failover for `runPveWith`/`runPve`, over the REAL `@distilled.cloud/proxmox`
 * protocol (real path assembly, real form encoding, real `{"data":...}` unwrap) instead of a
 * hand-built request — the distilled-backed counterpart to client.test.ts, same servers, same
 * rule, same helper shape. members.test.ts still owns the pre-send/any-transport classification
 * itself; this file only proves `runPveWith` obeys it when the request comes from the SDK.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { PveCredential, PveTarget } from './credentials.ts';
import { PveClusterExhausted, runPveWith } from './distilled-pve.ts';
import { orderedMembers, resetLastGoodForTest } from './members.ts';

type ServeOptions = {
  fetch(request: Request): Response | Promise<Response>;
  hostname: string;
  port: number;
};
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
  mount: 'proxmox-c1-test',
  scheme: 'pve',
});

/** Same remap as client.test.ts: https://member:8006 -> http://127.0.0.1:<port>. Never a live host. */
const remapFetch = (ports: Record<string, number>, underlying: typeof fetch = globalThis.fetch) =>
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
      return Promise.reject(
        Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), { code: 'ENOTFOUND' }),
      );
    },
    { preconnect: globalThis.fetch.preconnect },
  ) as typeof fetch;

const layerFor = (ports: Record<string, number>) =>
  FetchHttpClient.layer.pipe(
    Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, remapFetch(ports))),
  );

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  ports: Record<string, number> = {},
) => Effect.runPromise(effect.pipe(Effect.provide(layerFor(ports))));

/** A fake member answering PVE's own `{"data": ...}` envelope, counting its requests. */
const counting = (data: unknown, status = 200) => {
  let hits = 0;
  const server = Bun.serve({
    fetch: () => {
      hits += 1;
      return Response.json({ data }, { status });
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  return { hits: () => hits, port: server.port, stop: () => server.stop(true) };
};

const A = 'pve-a.test';
const B = 'pve-b.test';
const readAcl = access.listAccessAcl({});
const writeAcl = access.putAccessAcl({ path: '/', roles: 'PVEAuditor', users: 'a@pve' });

describe('runPveWith: cluster member failover over the distilled protocol', () => {
  it('skips an unresolvable first member and answers from the second', async () => {
    resetLastGoodForTest();
    const up = counting([{ path: '/', roleid: 'PVEAuditor', type: 'user', ugid: 'a@pve' }]);
    try {
      const rows = await run(runPveWith(target([A, B]), CRED, false, readAcl), { [B]: up.port });
      assert.equal(rows.length, 1);
    } finally {
      up.stop();
    }
  });

  it('does not fail over on an HTTP answer (a typed error) from the first member', async () => {
    resetLastGoodForTest();
    const bad = Bun.serve({
      fetch: () =>
        Response.json({ data: null, message: 'Permission check failed' }, { status: 403 }),
      hostname: '127.0.0.1',
      port: 0,
    });
    const good = counting([]);
    try {
      const error = await run(runPveWith(target([A, B]), CRED, false, readAcl).pipe(Effect.flip), {
        [A]: bad.port,
        [B]: good.port,
      });
      assert.equal((error as { _tag?: string })._tag, 'Forbidden');
      assert.equal(good.hits(), 0);
    } finally {
      bad.stop(true);
      good.stop();
    }
  });

  it('tries the last-good member first on the next call', async () => {
    resetLastGoodForTest();
    const serverA = counting([]);
    const serverB = counting([]);
    try {
      const t = target([A, B]);
      const ports = { [A]: serverA.port, [B]: serverB.port };
      await run(runPveWith(t, CRED, false, readAcl), ports);
      assert.equal(serverA.hits(), 1);
      assert.equal(serverB.hits(), 0);
      assert.deepEqual(orderedMembers(t), [A, B]);
      await run(runPveWith(t, CRED, false, access.listAccessAcl({})), ports);
      assert.equal(serverA.hits(), 2);
      assert.equal(serverB.hits(), 0);
    } finally {
      serverA.stop();
      serverB.stop();
    }
  });

  it('does not re-send a write after a transport timeout', async () => {
    resetLastGoodForTest();
    const hang = Bun.serve({
      fetch: () => new Promise<Response>(() => {}),
      hostname: '127.0.0.1',
      port: 0,
    });
    const backup = counting({});
    try {
      await run(
        runPveWith(target([A, B]), CRED, true, writeAcl).pipe(
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

  it('fails a write over when the first member refuses the connection', async () => {
    resetLastGoodForTest();
    const backup = counting({});
    try {
      // Loopback port 1 is closed: Bun answers ConnectionRefused before a byte is written.
      await run(runPveWith(target([A, B]), CRED, true, writeAcl), { [A]: 1, [B]: backup.port });
      assert.equal(backup.hits(), 1);
    } finally {
      backup.stop();
    }
  });

  it('names every member when all are down', async () => {
    resetLastGoodForTest();
    const error = await run(runPveWith(target([A, B]), CRED, false, readAcl).pipe(Effect.flip));
    assert.ok(error instanceof PveClusterExhausted);
    assert.match(error.message, /all members failed/);
    assert.match(error.message, new RegExp(A));
    assert.match(error.message, new RegExp(B));
  });

  /**
   * ⛔ UNLIKE THE 'transport timeout' TEST ABOVE, NO OUTER `Effect.timeout` HERE. That test's outer
   *   50ms wrapper wins the race regardless of whether `runPveWith` bounds an attempt itself — it
   *   would still pass with no internal bound at all. These inject the bound INTO `runPveWith`
   *   (never done in production, which always uses the real `MEMBER_TIMEOUT`), so a regression
   *   hangs node:test's own per-test timeout instead of quietly passing. See members-timeout.test.ts
   *   for the members.ts-level twin.
   */
  it('a hung read fails over to the next member, within the injected bound alone', async () => {
    resetLastGoodForTest();
    const hang = Bun.serve({
      fetch: () => new Promise<Response>(() => {}),
      hostname: '127.0.0.1',
      port: 0,
    });
    const good = counting([{ path: '/', roleid: 'PVEAuditor', type: 'user', ugid: 'a@pve' }]);
    try {
      const started = Date.now();
      const rows = await run(runPveWith(target([A, B]), CRED, false, readAcl, '100 millis'), {
        [A]: hang.port,
        [B]: good.port,
      });
      assert.equal(rows.length, 1);
      assert.equal(good.hits(), 1);
      assert.ok(Date.now() - started < 5000);
    } finally {
      hang.stop(true);
      good.stop();
    }
  });
});
