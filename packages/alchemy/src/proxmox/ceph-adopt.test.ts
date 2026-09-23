/**
 * The three Ceph Resources the barrel exports since 2026-09-22 — `CephDaemon`, `CephFs`,
 * `CephOsd` — adopted and then undeclared through Alchemy's own Plan and Apply, over a fake cluster.
 *
 * ★ WHY THESE THREE COULD JOIN THE BARREL AT ALL: each is adopt-only BY SHAPE, and this file is
 *   the proof rather than the claim. CephDaemon and CephFs compare nothing (`matches: () => true`),
 *   so a present object is always `noop` and never a replace; CephOsd reads the CRUSH tree and
 *   POSTs only when `dev` is declared, which nothing here does. All three default to `retain`.
 * ⛔ WHAT A MISTAKE HERE WOULD COST ON A REAL CLUSTER: a mon DELETE loses a quorum member, a CephFS
 *   DELETE breaks every mount, an OSD DELETE starts a rebalance. So every test ends on the same
 *   assertion — `fake.writes()` is empty — and one row proves the harness can still see a refusal.
 * ★ THE FIXTURE IS C1, THE KIT'S REFERENCE CLUSTER (docs/proxmox.md): three nodes, a mon, mgr and
 *   mds on each, one CephFS, two ssd OSDs per node — shapes and counts measured, names and
 *   addresses placeholders (RFC 5737). The rows carry only the keys the families read.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import {
  type CephDaemonKind,
  ProxmoxCephDaemon,
  ProxmoxCephDaemonProvider,
} from './ceph-daemon.ts';
import { ProxmoxCephFs, ProxmoxCephFsProvider } from './ceph-fs.ts';
import { ProxmoxCephOsd, ProxmoxCephOsdProvider } from './ceph-osd.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';

const NODES = ['node-b', 'node-c', 'node-d'] as const;
const KINDS: readonly CephDaemonKind[] = ['mon', 'mgr', 'mds'];
const ip = (node: string) => `198.51.100.${String(12 + NODES.indexOf(node as never))}`;

/**
 * One collection answer per kind. ⚠️ Every node answers the SAME cluster-wide list — measured on
 * C1, and the reason ceph-daemon-form.ts matches rows by `name` and never by position.
 */
const daemons: Record<CephDaemonKind, Record<string, unknown>[]> = {
  mds: NODES.map((node) => ({
    addr: `${ip(node)}:6801/1`,
    ceph_version_short: '20.2.2',
    host: node,
    name: node,
    rank: node === 'node-c' ? 0 : -1,
    service: true,
    standby_replay: false,
    state: node === 'node-c' ? 'up:active' : 'up:standby',
    ...(node === 'node-c' ? { fs_name: 'cephfs-c1' } : {}),
  })),
  mgr: NODES.map((node) => ({
    addr: ip(node),
    host: node,
    name: node,
    service: true,
    state: node === 'node-b' ? 'active' : 'standby',
  })),
  mon: NODES.map((node, rank) => ({
    addr: `${ip(node)}:6789/0`,
    host: node,
    name: node,
    quorum: 1,
    rank,
    service: true,
    state: 'running',
  })),
};

const fs = [
  {
    data_pool: 'cephfs-c1_data',
    data_pools: ['cephfs-c1_data'],
    metadata_pool: 'cephfs-c1_metadata',
    metadata_pool_id: 7,
    name: 'cephfs-c1',
  },
];

/** osd.{2,3} on node-b, osd.{1,4} on node-c, osd.{0,5} on node-d — C1's placement. */
const OSDS: readonly (readonly [number, string])[] = [
  [2, 'node-b'],
  [3, 'node-b'],
  [1, 'node-c'],
  [4, 'node-c'],
  [0, 'node-d'],
  [5, 'node-d'],
];

/** ⚠️ The tree spells ids as STRINGS (`"2"`), exactly as measured; ceph-osd-tree.ts narrows them. */
const tree = {
  flags: 'sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit',
  root: {
    children: [
      {
        children: NODES.map((host) => ({
          children: OSDS.filter(([, on]) => on === host).map(([id]) => ({
            device_class: 'ssd',
            host,
            id: String(id),
            in: 1,
            leaf: 1,
            name: `osd.${String(id)}`,
            osdtype: 'bluestore',
            status: 'up',
            type: 'osd',
          })),
          name: host,
          type: 'host',
        })),
        name: 'default',
        type: 'root',
      },
    ],
    leaf: 0,
  },
};

/** GETs answer from the fixture; anything else is recorded and answered like a task that ran. */
const cluster = () =>
  fakePve((call: PveCall) => {
    if (call.method !== 'GET') return 'UPID:node-b:fake';
    const hit = /^nodes\/[^/]+\/ceph\/(mon|mgr|mds|fs|osd)$/.exec(call.path)?.[1];
    if (hit === 'fs') return fs;
    if (hit === 'osd') return tree;
    return hit === undefined ? undefined : daemons[hit as CephDaemonKind];
  });

const providers = Layer.mergeAll(
  ProxmoxCephDaemonProvider(),
  ProxmoxCephFsProvider(),
  ProxmoxCephOsdProvider(),
);

/**
 * Every live Ceph object of the three families, declared the way a consuming stack would: each
 * daemon on the node it runs on, the filesystem asked of any node, each OSD's failure domain and
 * device class asserted.
 */
const everything = (osdHost: (host: string) => string = (host) => host) =>
  Effect.all([
    ...KINDS.flatMap((kind) =>
      NODES.map((node) =>
        ProxmoxCephDaemon(`${kind}-${node}`, { kind, node, target: FAKE_TARGET }),
      ),
    ),
    ProxmoxCephFs('cephfs-c1', { name: 'cephfs-c1', node: 'node-b', target: FAKE_TARGET }),
    ...OSDS.map(([osdid, host]) =>
      ProxmoxCephOsd(`osd-${String(osdid)}`, {
        device_class: 'ssd',
        host: osdHost(host),
        node: 'node-b',
        osdid,
        target: FAKE_TARGET,
      }),
    ),
  ]);

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(providers.pipe(Layer.provideMerge(fake.layer)));

describe('adopting the live Ceph daemons, filesystem and OSDs', () => {
  test('every row is noop to the verifier, adopted by the deploy, and only read', async () => {
    const fake = cluster();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(everything());
      expect(report.rows).toHaveLength(16);
      for (const row of report.rows) {
        expect(row).toMatchObject({ changed: [], diff: 'noop', ok: true, planned: 'adopted' });
      }
      const planned = await engine.deploy(everything());
      expect(new Set(Object.values(planned))).toEqual(new Set(['adopted']));
      expect(Object.keys(planned)).toHaveLength(16);
    });
    expect(fake.writes()).toEqual([]);
  });

  /**
   * ⛔ THE ONE THAT MATTERS MOST. `retain` is the whole reason a deleted line is not a lost mon, a
   *   destroyed filesystem or a pulled replica; Alchemy plans the removal `orphaned` and must drop
   *   only its own state row.
   */
  test('undeclaring all sixteen drops state rows and sends no DELETE', async () => {
    const fake = cluster();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(everything());
      expect(engine.stored()).toContain('mon-node-b');
      // ⚠️ `deploy` reports planned resources only; a removal lives in the plan's `deletions`, so
      //   the proof is the state store emptying and the cluster seeing no write.
      expect(await engine.deploy(Effect.void)).toEqual({});
      for (const fqn of ['mon-node-b', 'mds-node-c', 'cephfs-c1', 'osd-0']) {
        expect(engine.stored()).not.toContain(`"${fqn}"`);
      }
    });
    expect(fake.writes()).toEqual([]);
  });

  test('an OSD asserted on the wrong host fails the verifier and the deploy, and writes nothing', async () => {
    const fake = cluster();
    const moved = (host: string) => (host === 'node-b' ? 'node-c' : host);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(everything(moved));
      const wrong = report.rows.filter((row) => !row.ok).map((row) => row.fqn);
      expect(wrong.toSorted()).toEqual(['osd-2', 'osd-3']);
      expect(report.rows.find((row) => row.fqn === 'osd-2')?.changed).toEqual(['host']);
      await expect(engine.deploy(everything(moved))).rejects.toBeDefined();
    });
    expect(fake.writes()).toEqual([]);
  });
});
