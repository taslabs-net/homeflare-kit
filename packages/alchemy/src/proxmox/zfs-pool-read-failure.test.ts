/**
 * `Proxmox.ZfsPool`'s own cries-wolf fix, PLUS the request-shape and transient-failure fixes
 * kit 0.31.2/0.31.3 (PR 239/243) found for User/Group/Storage — all apply here too, this time on
 * a `read`-role read (this family never needed `provision` for GETs). Real-shaped fixtures (live
 * TB4 `n2` response bodies, measured 2026-09-24, nothing secret): `GET /nodes/n2/disks/zfs/rpool`
 * -> `{"data":{"name":"rpool","state":"ONLINE","errors":"No known data errors","children":[...]}}`,
 * and a missing pool -> a generic shelled-out `zpool status` failure at HTTP 500, the same class
 * of measured 500 as every other family this package has migrated.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';
import { ProxmoxZfsPool, ProxmoxZfsPoolProvider } from './zfs-pool.ts';

/**
 * One pool, an OpenBao mint the test can deny for `read` mid-run (the cries-wolf case), and a
 * cluster answer the test can break into a transient 500 mid-run (the request-shape regression's
 * own case) — never both at once, so one fixture serves every test below.
 */
const clusterOverPool = (node: string, name: string, live: Record<string, unknown>) => {
  let denyRead = false;
  let transient = false;
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      if (denyRead && url.pathname.endsWith('/creds/read')) {
        return Response.json({ errors: ['permission denied'] }, { status: 403 });
      }
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    if (request.method === 'GET') {
      // ⛔ THE REQUEST-SHAPE REGRESSION'S OWN SIGNATURE (user.ts/group.ts/storage.ts): a real
      //   fetch client refuses a GET carrying a body outright.
      expect(await request.text()).toBe('');
    }
    const wire = decodeURIComponent(url.pathname.replace(/^\/api2\/json\//, ''));
    if (wire !== `nodes/${node}/disks/zfs/${name}`) return Response.json({ data: null });
    if (transient) {
      // MEASURED 2026-09-24, live TB4: a missing pool answers exactly this shape.
      return Response.json(
        { data: null, message: `command '/sbin/zpool status -P ${name}' failed: exit code 1\n` },
        { status: 500 },
      );
    }
    return Response.json({ data: live });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    breakReads: () => {
      transient = true;
    },
    denyRead: () => {
      denyRead = true;
    },
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};

// MEASURED 2026-09-24, live TB4 `GET /nodes/n2/disks/zfs/rpool`.
const live = {
  children: [
    { children: [{ name: 'nvme-part3', state: 'ONLINE' }], name: 'rpool', state: 'ONLINE' },
  ],
  errors: 'No known data errors',
  name: 'rpool',
  state: 'ONLINE',
};
// ⚠️ ADOPT-ONLY (no `devices`/`raidlevel`, decision 9) — the pool is not one this test creates.
const declare = () =>
  ProxmoxZfsPool('n2-rpool', { name: 'rpool', node: 'n2', target: FAKE_TARGET });

describe("Proxmox.ZfsPool's own cries-wolf fix: a refused read mint reports noop, never update", () => {
  test('an already-adopted pool plans noop once the credential is denied, and nothing is written', async () => {
    const fake = clusterOverPool('n2', 'rpool', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxZfsPoolProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ 'n2-rpool': 'adopted' });
      fake.denyRead();
      const report = await engine.verify(declare(), { all: true });
      // ⛔ THE BUG THIS PROVES FIXED — same class as storage.ts's, measured for that family
      //   2026-09-24: before the dual-path fix this row read `update` with nothing compared.
      expect(report.rows[0]).toMatchObject({ diff: 'noop' });
      expect(await engine.deploy(declare())).toEqual({ 'n2-rpool': 'noop' });
    });
  });
});

describe('the same request-shape and transient-failure fixes, once for Proxmox.ZfsPool', () => {
  test('diff() propagates a transient read failure once a state row exists', async () => {
    const fake = clusterOverPool('n2', 'rpool', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxZfsPoolProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ 'n2-rpool': 'adopted' });
      fake.breakReads();
      // ⛔ THE FIX: this must REJECT, never resolve with a false 'update'.
      await expect(engine.verify(declare(), { all: true })).rejects.toBeDefined();
    });
  });

  test('alchemy drift never reports a transient failure as missing', async () => {
    const fake = clusterOverPool('n2', 'rpool', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxZfsPoolProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ 'n2-rpool': 'adopted' });
      fake.breakReads();
      // ⛔ THE FIX: this must REJECT. Without `read`'s `output` branch it resolved with
      //   `{ 'n2-rpool': { action: 'missing' } }` and no error anywhere.
      await expect(engine.drift(declare())).rejects.toBeDefined();
    });
  });
});
