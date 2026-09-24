/**
 * `Proxmox.NodeNetwork`'s absence signal, and the cries-wolf fix, through Alchemy's own Plan and
 * Apply over a fake cluster. Real-shaped fixtures (live TB4 `n2` response bodies, measured
 * 2026-09-24, nothing secret): `GET /nodes/n2/network/vmbr0` -> a full interface object; a
 * missing interface -> `{"errors":{"iface":"interface does not exist"},"data":null,"message":
 * "Parameter verification failed.\n"}` at HTTP 400 — THIS family's absence shape, distinct from
 * every other migrated family's measured 500.
 *
 * ★ ONLY THIS EXACT SIGNAL MEANS ABSENT. The tests below prove both directions: the specific
 *   400 lets `reconcile` create a genuinely new interface, and nothing else — a different 400
 *   reason, a 500, or a refused credential — is ever silently folded into "go ahead and create".
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';
import { ProxmoxNodeNetwork, ProxmoxNodeNetworkProvider } from './node-network.ts';

/**
 * One interface, an OpenBao mint the test can deny for `read` mid-run (the cries-wolf case), and
 * a `GET` answer the test can swap to any status/body (the absence-signal cases).
 */
const clusterOverInterface = (node: string, iface: string, live: Record<string, unknown>) => {
  let denyRead = false;
  let answer: 'live' | 'genuinely-absent' | 'other-400' | 'server-error' = 'live';
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
      // ⛔ THE REQUEST-SHAPE REGRESSION'S OWN SIGNATURE: a real fetch client refuses a GET
      //   carrying a body outright.
      expect(await request.text()).toBe('');
    }
    const wire = decodeURIComponent(url.pathname.replace(/^\/api2\/json\//, ''));
    if (request.method === 'POST' && wire === `nodes/${node}/network`) {
      answer = 'live';
      return Response.json({ data: null });
    }
    if (wire !== `nodes/${node}/network/${iface}`) return Response.json({ data: null });
    if (answer === 'genuinely-absent') {
      // MEASURED 2026-09-24, live TB4: a missing interface answers exactly this shape.
      return Response.json(
        {
          data: null,
          errors: { iface: 'interface does not exist' },
          message: 'Parameter verification failed.\n',
        },
        { status: 400 },
      );
    }
    if (answer === 'other-400') {
      return Response.json(
        {
          data: null,
          errors: { type: 'value does not look like a valid interface type' },
          message: 'Parameter verification failed.\n',
        },
        { status: 400 },
      );
    }
    if (answer === 'server-error') {
      return Response.json({ data: null, message: 'internal error\n' }, { status: 500 });
    }
    return Response.json({ data: live });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    denyRead: () => {
      denyRead = true;
    },
    setAnswer: (next: typeof answer) => {
      answer = next;
    },
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};

// MEASURED 2026-09-24, live TB4 `GET /nodes/n2/network/vmbr0`.
const live = {
  autostart: 1,
  bridge_ports: 'enp87s0',
  bridge_vids: '2-4094',
  bridge_vlan_aware: 1,
  type: 'bridge',
};
const declare = () =>
  ProxmoxNodeNetwork('n2-vmbr0', {
    autostart: true,
    bridge_ports: 'enp87s0',
    bridge_vids: '2-4094',
    bridge_vlan_aware: true,
    iface: 'vmbr0',
    node: 'n2',
    target: FAKE_TARGET,
    type: 'bridge',
  });

describe("Proxmox.NodeNetwork's own cries-wolf fix: a refused read mint reports noop, never update", () => {
  test('an already-adopted interface plans noop once the credential is denied, and nothing is written', async () => {
    const fake = clusterOverInterface('n2', 'vmbr0', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxNodeNetworkProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ 'n2-vmbr0': 'adopted' });
      fake.denyRead();
      const report = await engine.verify(declare(), { all: true });
      expect(report.rows[0]).toMatchObject({ diff: 'noop' });
      expect(await engine.deploy(declare())).toEqual({ 'n2-vmbr0': 'noop' });
    });
  });
});

describe('only the measured "interface does not exist" 400 means absent', () => {
  test('a genuinely new interface is created from exactly that signal', async () => {
    const fake = clusterOverInterface('n2', 'vmbr9', {});
    fake.setAnswer('genuinely-absent');
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxNodeNetworkProvider().pipe(Layer.provideMerge(fake.layer)));
      const declareNew = () =>
        ProxmoxNodeNetwork('n2-vmbr9', {
          iface: 'vmbr9',
          node: 'n2',
          target: FAKE_TARGET,
          type: 'bridge',
        });
      // ⚠️ The fake's POST handler flips `answer` back to `'live'`, so the read-back after
      //   create finds the interface — matching a real create landing.
      expect(await engine.deploy(declareNew())).toEqual({ 'n2-vmbr9': 'create' });
    });
  });

  test('a different 400 (not "interface does not exist") propagates instead of creating', async () => {
    const fake = clusterOverInterface('n2', 'vmbr0', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxNodeNetworkProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ 'n2-vmbr0': 'adopted' });
      fake.setAnswer('other-400');
      // ⛔ THE FIX: this must REJECT, never resolve with a false 'update' (or worse, a create).
      await expect(engine.verify(declare(), { all: true })).rejects.toBeDefined();
    });
  });

  test('a genuine 500 propagates instead of creating', async () => {
    const fake = clusterOverInterface('n2', 'vmbr0', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxNodeNetworkProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ 'n2-vmbr0': 'adopted' });
      fake.setAnswer('server-error');
      await expect(engine.verify(declare(), { all: true })).rejects.toBeDefined();
    });
  });

  test('alchemy drift never reports a transient failure as missing', async () => {
    const fake = clusterOverInterface('n2', 'vmbr0', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxNodeNetworkProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ 'n2-vmbr0': 'adopted' });
      fake.setAnswer('server-error');
      await expect(engine.drift(declare())).rejects.toBeDefined();
    });
  });
});
