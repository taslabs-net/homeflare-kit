/**
 * `Proxmox.ZfsPool` adopt-only mode (decision 9, 2026-09-23) through Alchemy's own Plan and
 * Apply, over a fake cluster. Adopt-only means `devices` and `raidlevel` are both left
 * undeclared — the only shape available for a pool PVE's own POST schema cannot fully describe,
 * such as n1's `speed`, whose layout is a stripe (decision 14 accepts it as-is).
 *
 * 🔴 THE BUG THIS PINS (measured 2026-09-23, before this change). `createForm` called
 *   `props.devices.join(',')` unconditionally, so the plan-time create guard — which evaluates
 *   `spec.createForm(props)` eagerly, before it even looks at `presence` (resource-guard.ts) —
 *   threw `TypeError: Cannot read properties of undefined (reading 'join')` for every adopt-only
 *   declaration, before the pool was ever read. Reverting `createForm`/`zfsPoolEndpoint` in
 *   zfs-pool-write.ts locally reproduces it: the first test below dies with that TypeError
 *   instead of adopting.
 * ⛔ WHAT A MISTAKE HERE WOULD COST ON A REAL CLUSTER: a POST that reached the wire without
 *   `devices`/`raidlevel` would be refused by PVE's own schema, but only after leaving this
 *   process; a DELETE reaching the wire on an undeclared line would run `zpool destroy`. So the
 *   no-create and no-delete tests both end on `fake.writes()` empty, and the mutation row proves
 *   the harness can still see a write when one is meant to happen.
 */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxZfsPool, ProxmoxZfsPoolProvider, type ZfsRaidLevel } from './zfs-pool.ts';

/** rpool on three nodes, plus rpool and a stripe `speed` on a fourth — n1's shape, placeholders. */
const FIVE: readonly (readonly [string, string])[] = [
  ['node-b', 'rpool'],
  ['node-c', 'rpool'],
  ['node-d', 'rpool'],
  ['node-e', 'rpool'],
  ['node-e', 'speed'],
];

const key = (node: string, name: string) => `${node}/${name}`;

/** Only the fields `zfs-pool-spec.ts`'s `attributes` reads; `name` non-empty is what "found" means. */
const poolAnswer = (name: string): Record<string, unknown> => ({
  children: [],
  errors: 'No known data errors',
  name,
  state: 'ONLINE',
});

/** A cluster holding exactly `present`; a DELETE removes its key, as `zpool destroy` would. */
const cluster = (present: Set<string>) =>
  fakePve((call: PveCall) => {
    const hit = /^nodes\/([^/]+)\/disks\/zfs\/([^/]+)$/.exec(call.path);
    if (hit === null) return undefined;
    const [, node = '', name = ''] = hit;
    if (call.method === 'GET') return present.has(key(node, name)) ? poolAnswer(name) : undefined;
    if (call.method === 'DELETE') {
      present.delete(key(node, name));
      return null;
    }
    return undefined;
  });

/** ⚠️ NO `devices`/`raidlevel` — the whole point of this file. */
const adoptOnly = (node: string, name: string) =>
  ProxmoxZfsPool(`${node}-${name}`, { name, node, target: FAKE_TARGET });

const allFive = () => Effect.all(FIVE.map(([node, name]) => adoptOnly(node, name)));
const presentFive = () => new Set(FIVE.map(([node, name]) => key(node, name)));

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxZfsPoolProvider().pipe(Layer.provideMerge(fake.layer)));

describe('adopting an adopt-only ZfsPool declaration', () => {
  test('rpool on three nodes, plus rpool and a stripe speed on a fourth: noop, adopted, no writes', async () => {
    const fake = cluster(presentFive());
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(allFive());
      expect(report.rows).toHaveLength(5);
      for (const row of report.rows) {
        expect(row).toMatchObject({ changed: [], diff: 'noop', ok: true, planned: 'adopted' });
      }
      const planned = await engine.deploy(allFive());
      expect(new Set(Object.values(planned))).toEqual(new Set(['adopted']));
      expect(Object.keys(planned)).toHaveLength(5);
    });
    expect(fake.writes()).toEqual([]);
  });

  test('undeclaring all five drops the state rows and sends no DELETE (retain is the default)', async () => {
    const fake = cluster(presentFive());
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(allFive());
      expect(engine.stored()).toContain('node-b-rpool');
      expect(await engine.deploy(Effect.void)).toEqual({});
      expect(engine.stored()).not.toContain('"node-b-rpool"');
    });
    expect(fake.writes()).toEqual([]);
  });

  test('an adopt-only pool that is absent: the deploy refuses, and writes nothing', async () => {
    const fake = cluster(new Set());
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await expect(engine.deploy(adoptOnly('node-b', 'rpool'))).rejects.toBeDefined();
    });
    expect(fake.writes()).toEqual([]);
  });

  test('an adopted pool that vanishes: the next plan refuses at the create guard, no writes', async () => {
    const present = new Set([key('node-b', 'rpool')]);
    const fake = cluster(present);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(adoptOnly('node-b', 'rpool'));
      present.delete(key('node-b', 'rpool')); // the pool is gone by the next deploy
      await expect(engine.deploy(adoptOnly('node-b', 'rpool'))).rejects.toBeDefined();
    });
    expect(fake.writes()).toEqual([]);
  });

  /**
   * ⛔ THE ONE THAT MATTERS MOST — the corrected header in zfs-pool.ts, proved. `retain` is why a
   *   dropped declaration above sent no DELETE; this shows the harness still sees a write when
   *   one is meant to happen, the way ceph-adopt.test.ts's mutation row does.
   */
  test('RemovalPolicy.destroy() then undeclaring sends exactly one DELETE', async () => {
    const fake = cluster(new Set([key('node-b', 'rpool')]));
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(adoptOnly('node-b', 'rpool').pipe(RemovalPolicy.destroy()));
      await engine.deploy(Effect.void);
    });
    expect(fake.writes()).toEqual(['DELETE nodes/node-b/disks/zfs/rpool']);
  });

  test('ZfsRaidLevel has no stripe: rejected at compile time, not just at runtime', () => {
    // @ts-expect-error 'stripe' is not in PVE's raidlevel enum (generated/pve.ts, decision 9)
    const r: ZfsRaidLevel = 'stripe';
    expect(String(r)).toBe('stripe');
  });

  /**
   * ⛔ FOUND BY ADVERSARIAL REVIEW, 2026-09-24: a genuinely FIRST-EVER declaration never reaches
   *   `diff` at all (upstream `Plan.ts` routes `oldState === undefined` straight to `create`), so
   *   the vendor-constraint check `diff` runs had never once protected a brand-new pool's own
   *   create -- only an ADOPT's later plans. `createPool` (zfs-pool-form.ts) now re-checks before
   *   its own POST, the same pattern `ceph-pool.ts`'s hand-written `reconcile` already uses.
   */
  test('a malformed ashift on a brand-new (non-adopt) declaration is refused before any write', async () => {
    const fake = cluster(new Set());
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const bad = () =>
        ProxmoxZfsPool('bad', {
          // ⛔ PVE's own bound is 9-16 (generated/constraints/pve-nodes-disks.ts) -- 99 is refused.
          ashift: 99,
          devices: ['/dev/disk/by-id/fake-0'],
          name: 'newpool',
          node: 'node-b',
          raidlevel: 'single',
          target: FAKE_TARGET,
        });
      await expect(engine.deploy(bad())).rejects.toBeDefined();
    });
    expect(fake.writes()).toEqual([]);
  });
});
