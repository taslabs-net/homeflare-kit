/**
 * `Proxmox.Storage`'s partial-update fix. Measured 2026-09-27, `bun run deploy`: PVE's PUT
 * /storage/{storage} refused `storage-cephfs-tb4`'s update with `unexpected property 'shared'`,
 * because `reconcile` used to PUT the FULL declared set whenever anything drifted — including a
 * `shared` that already matched live, which cephfs's own plugin `options()` never accepts at all
 * (storage-plugin-options.ts has the vendor citation). storage-form.ts's `updateForm` now sends
 * only the fields that actually differ from a live read; these tests prove the PUT body shape
 * directly, never touching a real PVE cluster.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxStorage, ProxmoxStorageProvider } from './storage.ts';

type Live = Record<string, string>;

/** `storage` (POST) and `storage/{id}` (GET/PUT), keyed by storage id — group.test.ts's shape. */
const cluster = (stores: Map<string, Live>) =>
  fakePve((call: PveCall) => {
    const match = /^storage(?:\/(.+))?$/.exec(call.path);
    if (match === null) return undefined;
    const id = match[1];
    if (call.method === 'GET' && id !== undefined) return stores.get(id);
    if (call.method === 'PUT' && id !== undefined) {
      const live = stores.get(id);
      if (live !== undefined) stores.set(id, { ...live, ...call.form });
    }
    return undefined;
  });

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxStorageProvider().pipe(Layer.provideMerge(fake.layer)));

describe('Proxmox.Storage update: a partial PUT, never a property the type refuses', () => {
  test('a cephfs storage whose only drift is content: PUT carries content and the id, never shared', async () => {
    // MEASURED SHAPE: live already reports `shared: '1'` (cephfs is implicitly shared) and the
    // declaration agrees — only `content` (Talos's `import`, the change that triggered the bug)
    // actually differs.
    const stores = new Map<string, Live>([
      ['cephfs-tb4', { content: 'backup', shared: '1', storage: 'cephfs-tb4', type: 'cephfs' }],
    ]);
    const fake = cluster(stores);
    const declare = () =>
      ProxmoxStorage('cephfs', {
        content: 'backup,import',
        shared: true,
        storage: 'cephfs-tb4',
        target: FAKE_TARGET,
        type: 'cephfs',
      });
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(declare());
      expect(report.rows[0]).toMatchObject({ diff: 'update' });
      expect(await engine.deploy(declare())).toEqual({ cephfs: 'adopted' });
    });
    // ⚠️ `storage` NAMES THE OBJECT VIA THE PUT'S OWN PATH (`storage/cephfs-tb4` here), NOT A
    //   BODY FIELD — distilled routes it as a path label (distilled-doctrine: Label -> path), so
    //   it never reaches `call.form`. `fake.writes()` is what proves the id.
    expect(fake.writes()).toEqual(['PUT storage/cephfs-tb4']);
    // ⛔ THE BUG THIS PROVES FIXED: before this fix the body was the full declared set, `shared`
    //   included — exactly what PVE refused with "unexpected property 'shared'".
    expect(fake.calls.find((call) => call.method === 'PUT')?.form).toEqual({
      content: 'backup,import',
    });
  });

  test('no drift at all: no PUT is sent', async () => {
    const stores = new Map<string, Live>([
      ['cephfs-tb4', { content: 'backup,import', storage: 'cephfs-tb4', type: 'cephfs' }],
    ]);
    const fake = cluster(stores);
    const declare = () =>
      ProxmoxStorage('cephfs', {
        content: 'backup,import',
        storage: 'cephfs-tb4',
        target: FAKE_TARGET,
        type: 'cephfs',
      });
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(declare());
      expect(report.rows[0]).toMatchObject({ diff: 'noop' });
      // ⚠️ `'adopted'`, NOT `'noop'` — a first deploy of a matching object is always reported
      //   `adopted` (adopt-verify.md's own note on Plan.ts/Apply.ts: "the node is adopted either
      //   way"). The provider's own `diff` (asserted above) is what proves nothing changed;
      //   `fake.writes()` below is what proves `reconcile` actually wrote nothing.
      expect(await engine.deploy(declare())).toEqual({ cephfs: 'adopted' });
    });
    expect(fake.writes()).toEqual([]);
  });

  test('a dir storage DOES accept `shared` on update: the PUT carries it', async () => {
    // VENDOR EVIDENCE (storage-plugin-options.ts): `DirPlugin.pm`'s own `options()` names
    // `shared => { optional => 1 }`, unlike cephfs — this is the "one more type" contrast case.
    const stores = new Map<string, Live>([
      ['local-extra', { content: 'iso', shared: '0', storage: 'local-extra', type: 'dir' }],
    ]);
    const fake = cluster(stores);
    const declare = () =>
      ProxmoxStorage('dir', {
        content: 'iso',
        shared: true,
        storage: 'local-extra',
        target: FAKE_TARGET,
        type: 'dir',
      });
    await withoutBao(async () => {
      const engine = engineFor(fake);
      expect(await engine.deploy(declare())).toEqual({ dir: 'adopted' });
    });
    expect(fake.writes()).toEqual(['PUT storage/local-extra']);
    expect(fake.calls.find((call) => call.method === 'PUT')?.form).toEqual({ shared: '1' });
  });
});
