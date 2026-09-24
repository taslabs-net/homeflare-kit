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
import { ProxmoxCephDaemon, ProxmoxCephDaemonProvider } from './ceph-daemon.ts';
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
