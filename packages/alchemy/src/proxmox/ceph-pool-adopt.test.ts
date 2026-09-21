/**
 * `Proxmox.CephPool` adopted through Alchemy's own Plan and Apply, over a fake cluster.
 *
 * 🔴 THE BUG THIS PINS (found 2026-09-21, update-guard.ts). The family's hand-written reconcile
 *   PUT the declared set whenever the pool existed. Plan.ts forces reconcile after the adoption
 *   probe even when the diff says `noop`, so adopting a pool that already matched sent `setpool`
 *   and forked a worker on the live cluster. The first test fails with that PUT on the old code.
 * ★ THE VERIFIER RUNS OVER THE SAME ENGINE, so the same test also shows what it reports before
 *   the deploy: `adopted` from the engine, `noop` from the provider.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxCephPool, ProxmoxCephPoolProvider } from './ceph-pool.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';

const STATUS = 'nodes/n2/ceph/pool/cephtb4/status?verbose=1';
const OBJECT = 'nodes/n2/ceph/pool/cephtb4';

/** TB4's rbd pool as `getpool` answers it — the fields ceph-pool.ts reads. */
const livePool = (size: number): Record<string, unknown> => ({
  application_list: ['rbd'],
  crush_rule: 'replicated_rule',
  id: 2,
  min_size: 2,
  name: 'cephtb4',
  pg_autoscale_mode: 'on',
  pg_num: 128,
  size,
});

/** A cluster holding one pool; a PUT to it lands, as `setpool` would. */
const cluster = (size: number) => {
  const pool = livePool(size);
  return fakePve((call: PveCall) => {
    if (call.method === 'GET' && call.path === STATUS) return pool;
    if (call.method === 'PUT' && call.path === OBJECT) {
      for (const [key, value] of Object.entries(call.form)) {
        pool[key] = /^\d+$/.test(value) ? Number(value) : value;
      }
      return 'UPID:n2:fake:setpool';
    }
    return undefined;
  });
};

const declared = () =>
  ProxmoxCephPool('cephtb4', {
    crush_rule: 'replicated_rule',
    min_size: 2,
    name: 'cephtb4',
    node: 'n2',
    pg_autoscale_mode: 'on',
    size: 3,
    target: FAKE_TARGET,
  });

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxCephPoolProvider().pipe(Layer.provideMerge(fake.layer)));

describe('adopting a Ceph pool', () => {
  test('that already matches: the verifier says noop, and the deploy only reads', async () => {
    const fake = cluster(3);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(declared());
      expect(report.rows).toEqual([
        expect.objectContaining({ diff: 'noop', ok: true, planned: 'adopted', read: 'found' }),
      ]);
      expect(await engine.deploy(declared())).toEqual({ cephtb4: 'adopted' });
    });
    expect(fake.writes()).toEqual([]);
    expect(fake.calls.every((call) => call.path === STATUS)).toBe(true);
  });

  test('that drifted: the verifier names the field, and the deploy PUTs once', async () => {
    const fake = cluster(2);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(declared());
      expect(report.rows[0]).toMatchObject({ changed: ['size'], diff: 'update', ok: false });
      expect(fake.writes()).toEqual([]);
      expect(await engine.deploy(declared())).toEqual({ cephtb4: 'adopted' });
    });
    expect(fake.writes()).toEqual([`PUT ${OBJECT}`]);
    expect(fake.calls.find((call) => call.method === 'PUT')?.form['size']).toBe('3');
  });
});
