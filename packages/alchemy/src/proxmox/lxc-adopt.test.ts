/**
 * The adoption gate, through Alchemy's real plan and apply over a fake PVE holding a
 * production-shaped guest (placeholders only).
 *
 * ⛔ WHAT THESE PIN: a declaration pasted from the live config plans `adopted` with no warning,
 *   its deploy writes NOTHING, and the next plan is `noop`; the create spellings (`storage:size`,
 *   a NIC without its MAC) adopt as cleanly; drift is named at plan and written as one PUT that
 *   keeps the live MAC and carries the digest; and every change PVE cannot make in place fails the
 *   plan with nothing written. Deleting both empty-change guards (reconcile's in lxc.ts and
 *   `updateGuest`'s in lxc-lifecycle.ts), or the hwaddr carry in lxc-wire.ts, fails a test here —
 *   each MEASURED by making that edit and running this file, 2026-09-21.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import { type FakePve, fakePve, writesOf } from './fake-pve-lxc.ts';
import { LIVE, TARGET, lxcEngine, seed } from './lxc-harness.ts';
import { ProxmoxLxc } from './lxc.ts';
import type { LxcProps } from './lxc-props.ts';

const NODE = 'pve1';
const VMID = 100;

/** The live config as a declaration: every key, minus what pvesh adds that is not a prop. */
const pasted = (): LxcProps => {
  const { lxc: _raw, ...config } = LIVE;
  return { ...(config as Partial<LxcProps>), node: NODE, target: TARGET, vmid: VMID };
};

const ct = (props: LxcProps) => ProxmoxLxc('ct', props).pipe(adopt(true));

let fake: FakePve | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});
const live = () => {
  fake = fakePve();
  seed(fake, NODE, VMID);
  return fake;
};

describe('adopting a live container', () => {
  test('the pasted config plans adopted, deploys with no write, and then plans noop', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    const first = await stack.plan(ct(pasted()));
    expect(first).toEqual({ actions: { ct: 'adopted' }, failure: '', warnings: [] });
    const deployed = await stack.deploy(ct(pasted()));
    expect(deployed.failure).toBe('');
    expect(writesOf(pve)).toEqual([]);
    expect(stack.status('ct')).toBe('updated');
    expect(await stack.plan(ct(pasted()))).toEqual({
      actions: { ct: 'noop' },
      failure: '',
      warnings: [],
    });
  });

  test('create spellings and PVE defaults compare equal to the live config', async () => {
    const stack = lxcEngine(live());
    const props: LxcProps = {
      ...pasted(),
      mp0: 'tank:200,mp=/data',
      net0: 'bridge=vmbr0,name=eth0,gw=192.0.2.1,ip=192.0.2.10/24,mtu=1500,tag=42',
      net1: 'name=eth1,bridge=vmbr1,ip=198.51.100.4/24,mtu=1500,firewall=0',
      onboot: true,
      rootfs: 'local-zfs:40',
      tags: 'WEB',
      unprivileged: true,
    };
    expect(await stack.plan(ct(props))).toEqual({
      actions: { ct: 'adopted' },
      failure: '',
      warnings: [],
    });
  });

  test('a declaration naming only node and vmid adopts without touching anything', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    const deployed = await stack.deploy(ct({ node: NODE, target: TARGET, vmid: VMID }));
    expect(deployed.failure).toBe('');
    expect(writesOf(pve)).toEqual([]);
  });
});

describe('drift at adoption is named at plan and written once', () => {
  test('memory and an MTU change: one PUT, the live MAC kept, the digest carried', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    const props: LxcProps = {
      ...pasted(),
      memory: 4096,
      net1: 'name=eth1,bridge=vmbr1,ip=198.51.100.4/24,mtu=9000',
    };
    const planned = await stack.plan(ct(props));
    expect(planned.actions).toEqual({ ct: 'adopted' });
    expect(planned.warnings.join('\n')).toContain('differs from the declaration in memory, net1');
    expect((await stack.deploy(ct(props))).failure).toBe('');
    expect(writesOf(pve)).toEqual([`PUT nodes/${NODE}/lxc/${String(VMID)}/config`]);
    const put = pve.seen.find((call) => call.method === 'PUT')?.form;
    expect(put?.get('memory')).toBe('4096');
    expect(put?.get('net1')).toContain('hwaddr=00:00:5E:00:53:02');
    expect(put?.get('digest')).toBe('digest-live');
    expect((await stack.plan(ct(props))).actions).toEqual({ ct: 'noop' });
  });

  test('a larger rootfs is a resize after the config, never a new volume', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    const props: LxcProps = { ...pasted(), rootfs: 'local-zfs:subvol-100-disk-0,size=64G' };
    expect((await stack.deploy(ct(props))).failure).toBe('');
    expect(writesOf(pve)).toEqual([`PUT nodes/${NODE}/lxc/${String(VMID)}/resize`]);
    expect(pve.guests.get(`${NODE}/${String(VMID)}`)?.['rootfs']).toContain('size=64G');
  });
});

describe('changes PVE cannot make in place fail the plan and write nothing', () => {
  test.each([
    ['a smaller mount point', { mp0: 'tank:subvol-100-disk-0,mp=/data,size=100G' }, /shrink/],
    ['a storage move', { rootfs: 'other:40' }, /pct move-volume/],
    ['an unprivileged flip', { unprivileged: 0 as const }, /read-only option/],
    ['a device passthrough change', { dev1: '/dev/fuse' }, /pct set 100 --dev1/],
    ['a feature beyond nesting', { features: 'nesting=1,keyctl=1' }, /root@pam/],
    ['detaching a mount point', { mp0: '' }, /unusedN/],
  ])('%s', async (_, change, reason) => {
    const pve = live();
    const run = await lxcEngine(pve).deploy(ct({ ...pasted(), ...change } as LxcProps));
    expect(run.failure).toMatch(reason);
    expect(writesOf(pve)).toEqual([]);
  });

  test('a vmid held elsewhere in the cluster fails the plan instead of planning a create', async () => {
    const pve = live();
    pve.others.push({ node: 'pve2', type: 'qemu', vmid: 101 });
    const run = await lxcEngine(pve).plan(ct({ ...pasted(), vmid: 101 }));
    expect(run.failure).toContain('vmid 101 is a qemu on pve2');
    expect(writesOf(pve)).toEqual([]);
  });
});

describe('a guest another tool moved', () => {
  const migrate = (pve: FakePve, to: string) => {
    const config = pve.guests.get(`${NODE}/${String(VMID)}`) ?? {};
    pve.guests.delete(`${NODE}/${String(VMID)}`);
    pve.guests.set(`${to}/${String(VMID)}`, config);
  };

  test('after HA moves it, the old node fails the plan; the new node is a write-free update', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    await stack.deploy(ct(pasted()));
    migrate(pve, 'pve2');
    expect((await stack.plan(ct(pasted()))).failure).toContain('is a lxc on pve2');
    const follow = await stack.deploy(ct({ ...pasted(), node: 'pve2' }));
    expect(follow.actions).toEqual({ ct: 'update' });
    expect(follow.warnings.join('\n')).toContain('on pve2 now, not pve1');
    expect(writesOf(pve)).toEqual([]);
    expect((await stack.plan(ct({ ...pasted(), node: 'pve2' }))).actions).toEqual({ ct: 'noop' });
  });

  test('naming another node the guest is not on is refused, never a second guest', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    await stack.deploy(ct(pasted()));
    const run = await stack.deploy(ct({ ...pasted(), node: 'pve2' }));
    expect(run.failure).toContain('is a lxc on pve1, not a container on pve2');
    expect(writesOf(pve)).toEqual([]);
  });
});
