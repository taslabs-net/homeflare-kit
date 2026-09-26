/**
 * `Proxmox.Vm` identity — red-team I1 on PR 297, through the real engine over a stub fetch.
 * ⛔ WHAT THIS PINS: a changed `vmid` on an already-managed VM is refused as a different machine,
 *   never planned as an `update` (which used to POST a second VM and leave the first one running
 *   and untracked).
 */
import { expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxVm, ProxmoxVmProvider } from './qemu.ts';

const NODE = 'pve1';
const props = { node: NODE, target: FAKE_TARGET, vmid: 150 };
const live = { digest: 'a'.repeat(40), memory: '512' };

const engine = (fake: ReturnType<typeof fakePve>) =>
  engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)));

test('a changed vmid is refused as a different VM, never planned as an update', async () => {
  const fake = fakePve((call) => (call.method === 'GET' ? live : null));
  await withoutBao(async () => {
    const stack = engine(fake);
    await stack.deploy(ProxmoxVm('row', props));
    await expect(stack.deploy(ProxmoxVm('row', { ...props, vmid: 151 }))).rejects.toThrow(
      /vmid: 150 -> 151 is a different VM/,
    );
  });
  expect(fake.writes()).toEqual([]);
});
