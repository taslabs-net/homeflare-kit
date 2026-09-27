/**
 * `Proxmox.CephOsd`'s create path, through Alchemy's own Plan and Apply over a fake cluster.
 *
 * ⚠️ THIS NEVER RUNS ON THE REAL CLUSTER — ceph-osd.ts's own header has the measured reason
 *   (`createosd`/`destroyosd` carry no PVE permissions block, so any OpenBao-minted token 403s
 *   regardless of transport). The fake here enforces no such check, which is exactly why it is
 *   worth running: it is the only way to catch a wire-translation bug (a wrong field name, a
 *   dropped `device_class`) that a real deploy would never reach far enough to expose.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxCephOsd, ProxmoxCephOsdProvider } from './ceph-osd.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';

const NODE = 'node-b';
const TREE = `nodes/${NODE}/ceph/osd`;

describe('a genuinely new OSD', () => {
  test('POSTs dev and crush-device-class, and reads the new leaf back by id', async () => {
    let created = false;
    const fake = fakePve((call: PveCall) => {
      if (call.method === 'GET' && call.path === TREE) {
        const leaves = created
          ? [
              {
                ceph_version_short: '20.2.2',
                device_class: 'ssd',
                host: NODE,
                id: '9',
                name: 'osd.9',
                status: 'up',
              },
            ]
          : [];
        return { flags: '', root: { children: leaves.map((l) => ({ ...l, type: 'osd' })) } };
      }
      if (call.method === 'POST' && call.path === TREE) {
        created = true;
        return `UPID:${NODE}:fake:createosd`;
      }
      return undefined;
    });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephOsdProvider().pipe(Layer.provideMerge(fake.layer)));
      const declared = () =>
        ProxmoxCephOsd('node-b-osd9', {
          dev: '/dev/nvme2n1',
          device_class: 'ssd',
          node: NODE,
          osdid: 9,
          target: FAKE_TARGET,
        });
      expect(await engine.deploy(declared())).toEqual({ 'node-b-osd9': 'create' });
    });
    const post = fake.calls.find((c) => c.method === 'POST');
    expect(post?.form['dev']).toBe('/dev/nvme2n1');
    expect(post?.form['crush-device-class']).toBe('ssd');
    expect(fake.writes()).toEqual([`POST ${TREE}`]);
  });
});
