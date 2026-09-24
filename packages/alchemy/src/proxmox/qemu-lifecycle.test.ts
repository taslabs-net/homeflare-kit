/** QEMU engine tests over a stub fetch. No live host is contacted. */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type FakePve, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxVm, ProxmoxVmProvider } from './qemu.ts';

const NODE = 'pve1';
const VMID = 150;
const props = { target: FAKE_TARGET, node: NODE, vmid: VMID };
const digest = 'a'.repeat(40);
const live = { digest, name: 'vm150', memory: '512', cores: 1, sockets: 1, onboot: 0 };
const missing = () =>
  Response.json(
    {
      data: null,
      message: `Configuration file 'nodes/${NODE}/qemu-server/${String(VMID)}.conf' does not exist\n`,
    },
    { status: 500 },
  );
const UPID = `UPID:${NODE}:00000001:0:0:qmcreate:${String(VMID)}:test@pve!fake:`;

const engine = (fake: FakePve) =>
  engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)));

const isIndex = (call: { method: string; path: string }) =>
  call.method === 'GET' && call.path.startsWith('cluster/resources');

describe('Proxmox.Vm distilled transport', () => {
  test('adoption and a second plan write nothing', async () => {
    const fake = fakePve((call) => (call.method === 'GET' ? live : null));
    await withoutBao(async () => {
      const stack = engine(fake);
      expect(await stack.deploy(ProxmoxVm('row', props))).toEqual({ row: 'adopted' });
      expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows).toEqual([
        expect.objectContaining({ diff: 'noop', ok: true }),
      ]);
    });
    expect(fake.writes()).toEqual([]);
  });

  test('absence creates on the collection route, waits, then settles', async () => {
    let exists = false;
    const fake = fakePve((call) => {
      if (call.path.includes('/tasks/') && call.path.endsWith('/status')) {
        return { status: 'stopped', exitstatus: 'OK' };
      }
      if (isIndex(call)) return [];
      if (call.method === 'GET') return exists ? live : missing();
      exists = true;
      return UPID;
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      await stack.deploy(
        ProxmoxVm('row', { ...props, net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0' }),
      );
      expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
        diff: 'noop',
      });
    });
    expect(fake.writes()).toEqual([`POST nodes/${NODE}/qemu`]);
    expect(fake.calls.find((call) => call.method === 'POST')?.form['net0']).toBe(
      'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
    );
    expect(fake.calls.some((call) => call.path.includes('/tasks/'))).toBe(true);
  });

  test('a vmid held by a container is not created', async () => {
    const fake = fakePve((call) => {
      if (isIndex(call)) {
        return [{ id: 'lxc/150', type: 'lxc', vmid: 150, node: 'pve2' }];
      }
      if (call.method === 'GET') return missing();
      return UPID;
    });
    await withoutBao(async () => {
      await expect(engine(fake).deploy(ProxmoxVm('row', props))).rejects.toThrow(
        /container|lxc|pve2/,
      );
    });
    expect(fake.writes()).toEqual([]);
  });

  test('drift updates the config route and the next plan is a no-op', async () => {
    let current: unknown = { ...live, memory: '256' };
    const fake = fakePve((call) => {
      if (call.method === 'GET') return current;
      current = live;
      return null;
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
        diff: 'update',
      });
      await stack.deploy(ProxmoxVm('row', props));
      expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
        diff: 'noop',
      });
    });
    expect(fake.writes()).toEqual([`PUT nodes/${NODE}/qemu/${String(VMID)}/config`]);
  });

  test('unrelated read failures and a digest-less body do not write', async () => {
    for (const body of [
      Response.json({ data: null, message: 'unrelated failure' }, { status: 500 }),
      Response.json({ data: null, message: 'permission denied' }, { status: 403 }),
      { name: 'vm150' },
    ]) {
      const fake = fakePve(() => body);
      await withoutBao(async () => {
        await expect(engine(fake).deploy(ProxmoxVm('row', props))).rejects.toBeDefined();
      });
      expect(fake.writes()).toEqual([]);
    }
  });

  test('destroy deletes the guest route and waits for its task', async () => {
    let exists = true;
    const fake = fakePve((call) => {
      if (call.path.includes('/tasks/') && call.path.endsWith('/status')) {
        return { status: 'stopped', exitstatus: 'OK' };
      }
      if (call.method === 'GET') return exists ? live : missing();
      if (call.method === 'DELETE') {
        exists = false;
        return UPID;
      }
      return null;
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      await stack.deploy(ProxmoxVm('row', props).pipe(RemovalPolicy.destroy()));
      await stack.deploy(Effect.void);
    });
    expect(fake.writes()).toEqual([`DELETE nodes/${NODE}/qemu/${String(VMID)}`]);
    expect(fake.writes().some((line) => line.includes('/config'))).toBe(false);
  });
});
