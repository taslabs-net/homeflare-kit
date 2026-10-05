/** Failed creates resume through Alchemy's real state recovery, with adoption disabled. */
import { expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxVm, ProxmoxVmProvider } from './qemu.ts';

const props = {
  target: FAKE_TARGET,
  node: 'n2',
  vmid: 10000,
  name: 'talos',
  scsi0: 'cephtb4:0,import-from=cephfs-tb4:import/talos.raw',
  diskSizesGiB: { scsi0: 64 },
};
const path = 'nodes/n2/qemu/10000';
const importTask = 'UPID:n2:1:0:0:qmcreate:10000:test@pve!fake:';
const resizeTask = 'UPID:n2:2:0:0:qmresize:10000:test@pve!fake:';

for (const otherDrift of [false, true]) {
  test(`failed resize recovery without adoption (other config drift: ${otherDrift})`, async () => {
    let created = false;
    let resized = false;
    let attempts = 0;
    let name = props.name;
    const fake = fakePve((call) => {
      if (call.path.startsWith('cluster/resources')) return [];
      if (call.path.includes(encodeURIComponent(importTask)))
        return { status: 'stopped', exitstatus: 'OK' };
      if (call.path.includes(encodeURIComponent(resizeTask))) {
        resized = attempts > 1;
        return { status: 'stopped', exitstatus: resized ? 'OK' : 'disk resize failed' };
      }
      if (call.path === `${path}/config`)
        return created
          ? {
              digest: 'a'.repeat(40),
              name,
              scsi0: `cephtb4:vm-10000-disk-0,size=${resized ? '64G' : '4.15G'}`,
            }
          : Response.json(
              {
                data: null,
                message: "Configuration file 'nodes/n2/qemu-server/10000.conf' does not exist\n",
              },
              { status: 500 },
            );
      if (call.method === 'POST') {
        created = true;
        return importTask;
      }
      if (call.path === `${path}/resize`) {
        attempts++;
        return resizeTask;
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    await withoutBao(async () => {
      const stack = engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)), {
        adopt: false,
      });
      await expect(stack.deploy(ProxmoxVm('row', props))).rejects.toThrow(/disk resize failed/);
      if (otherDrift) {
        name = 'someone-else';
        await expect(stack.deploy(ProxmoxVm('row', props))).rejects.toThrow(/adopt/i);
      } else {
        await stack.deploy(ProxmoxVm('row', props));
        await stack.deploy(ProxmoxVm('row', props));
        expect(resized).toBe(true);
        expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
          diff: 'noop',
        });
      }
    });
    expect(fake.writes()).toEqual([
      'POST nodes/n2/qemu',
      `PUT ${path}/resize`,
      ...(otherDrift ? [] : [`PUT ${path}/resize`]),
    ]);
  });
}
