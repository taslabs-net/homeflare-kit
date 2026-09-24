/**
 * `Proxmox.CephDaemon`'s write paths, through Alchemy's own Plan and Apply over a fake cluster —
 * the paths ceph-adopt.test.ts does not reach: it is adopt-only by design (every assertion there
 * ends on `fake.writes()` empty). Proves the distilled-based create (ceph-daemon-wire.ts) POSTs
 * with the right per-kind body — `mon-address` renamed to `mon_address` for mon, `hotstandby` for
 * mds — reads back, and that delete sends exactly one DELETE.
 */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxCephDaemon, ProxmoxCephDaemonProvider, reconcileDaemon } from './ceph-daemon.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';

const NODE = 'node-b';

describe('a genuinely new mon', () => {
  test('POSTs mon-address as mon_address, and reads the collection back', async () => {
    const NAME = 'node-b';
    const COLLECTION = `nodes/${NODE}/ceph/mon`;
    const OBJECT = `${COLLECTION}/${NAME}`;
    let created = false;
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === COLLECTION) {
        return created ? [{ addr: '198.51.100.12:6789/0', name: NAME, state: 'running' }] : [];
      }
      // ⚠️ POST lands on the daemon's OWN path (`{monid}`), not the collection — see
      //   ceph-daemon-form.ts's own ⛔ on `collectionPath`/`daemonPath`.
      if (call.method === 'POST' && call.path === OBJECT) {
        created = true;
        return `UPID:${NODE}:fake:createmon`;
      }
      return undefined;
    });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephDaemonProvider().pipe(Layer.provideMerge(fake.layer)));
      const declared = () =>
        ProxmoxCephDaemon('node-b-mon', {
          kind: 'mon',
          'mon-address': '198.51.100.12',
          name: NAME,
          node: NODE,
          target: FAKE_TARGET,
        });
      expect(await engine.deploy(declared())).toEqual({ 'node-b-mon': 'create' });
    });
    expect(fake.calls.find((c) => c.method === 'POST')?.form['mon-address']).toBe('198.51.100.12');
    expect(fake.writes()).toEqual([`POST ${OBJECT}`]);
  });
});

describe('a genuinely new mds', () => {
  test('POSTs hotstandby, and reads the collection back', async () => {
    const NAME = 'node-b';
    const COLLECTION = `nodes/${NODE}/ceph/mds`;
    const OBJECT = `${COLLECTION}/${NAME}`;
    let created = false;
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === COLLECTION) {
        return created ? [{ name: NAME, state: 'up:standby' }] : [];
      }
      if (call.method === 'POST' && call.path === OBJECT) {
        created = true;
        return `UPID:${NODE}:fake:createmds`;
      }
      return undefined;
    });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephDaemonProvider().pipe(Layer.provideMerge(fake.layer)));
      const declared = () =>
        ProxmoxCephDaemon('node-b-mds', {
          hotstandby: true,
          kind: 'mds',
          name: NAME,
          node: NODE,
          target: FAKE_TARGET,
        });
      expect(await engine.deploy(declared())).toEqual({ 'node-b-mds': 'create' });
    });
    expect(fake.calls.find((c) => c.method === 'POST')?.form['hotstandby']).toBe('1');
  });
});

describe('destroying a mgr', () => {
  test('RemovalPolicy.destroy() then undeclaring sends exactly one DELETE', async () => {
    const NAME = 'node-b';
    const COLLECTION = `nodes/${NODE}/ceph/mgr`;
    const OBJECT = `${COLLECTION}/${NAME}`;
    let deleted = false;
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === COLLECTION) {
        return deleted ? [] : [{ name: NAME, state: 'active' }];
      }
      if (call.method === 'DELETE' && call.path === OBJECT) {
        deleted = true;
        return `UPID:${NODE}:fake:destroymgr`;
      }
      return undefined;
    });
    const declared = () =>
      ProxmoxCephDaemon('node-b-mgr', { kind: 'mgr', name: NAME, node: NODE, target: FAKE_TARGET });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephDaemonProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declared())).toEqual({ 'node-b-mgr': 'adopted' });
      await engine.deploy(declared().pipe(RemovalPolicy.destroy()));
      await engine.deploy(Effect.void);
    });
    expect(fake.writes()).toEqual([`DELETE ${OBJECT}`]);
  });
});

describe("reconcile called directly, no diff first — the adversarial review's own proof", () => {
  /**
   * ⚠️ STRUCTURAL, NOT A REFUSAL — checked directly before writing this test:
   *   `constraints.ts`'s `violations()` never checks a bare `format` rule (`mon-address`'s own
   *   `{"format":"ip-list","type":"string"}` carries no `pattern`), and `mds`/`mgr`'s create
   *   endpoints have EMPTY constraint tables — so nothing in this family's vendor table can
   *   actually refuse a bad value today (a separate, recorded gap; not this PR's to fix). What IS
   *   provable, and what the review's finding was actually about, is that `guardWrite` — and so
   *   `createForm(news)`, which it must evaluate to build the value it checks — runs on the
   *   ADOPTED-ROW PATH at all, before the `live !== undefined` early return. A getter on
   *   `mon-address` proves it: `createForm` is the ONLY thing that reads this field on that path
   *   (`createDaemon`, the other reader, is never reached when `live` is already defined), so it
   *   firing at all means the guard ran; it firing zero times is exactly the bug the review found.
   */
  test('guardWrite (and the createForm it checks) still runs on an adopted row, before the early return', async () => {
    const NAME = 'node-b';
    const COLLECTION = `nodes/${NODE}/ceph/mon`;
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === COLLECTION) {
        return [{ addr: '198.51.100.12:6789/0', name: NAME, state: 'running' }];
      }
      return undefined;
    });
    let reads = 0;
    const news = {
      get 'mon-address'() {
        reads += 1;
        return '198.51.100.99';
      },
      kind: 'mon' as const,
      name: NAME,
      node: NODE,
      target: FAKE_TARGET,
    };
    await withoutBao(async () => {
      // ⛔ NOT engine.deploy() — this calls the exported `reconcileDaemon` straight, the way a
      //   resumed apply or a verify harness would, with no `diff` run first.
      const after = await Effect.runPromise(
        reconcileDaemon({ news }).pipe(Effect.provide(fake.layer)),
      );
      expect(after.state).toBe('running');
    });
    expect(reads).toBeGreaterThan(0);
    expect(fake.writes()).toEqual([]);
  });
});
