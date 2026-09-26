/** QEMU engine tests over a stub fetch. No live host is contacted. */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type FakePve, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxVm, ProxmoxVmProvider, type VmProps } from './qemu.ts';

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
    let posted: Record<string, string> | undefined;
    const fake = fakePve((call) => {
      if (call.path.includes('/tasks/') && call.path.endsWith('/status')) {
        return { status: 'stopped', exitstatus: 'OK' };
      }
      if (isIndex(call)) return [];
      // ⚠️ `net0` IS NOW A MANAGED, COMPARED KEY (qemu-props.ts) — the old fixture answered the
      //   SAME static `live` regardless of what was posted, which only worked because the old
      //   `matches` never looked at `net0` at all. Echoing the create form back is what proves
      //   the declared value is what a real PVE config would report.
      if (call.method === 'GET') return posted === undefined ? missing() : { ...live, ...posted };
      posted = call.form;
      return UPID;
    });
    const declared = { ...props, net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0' };
    await withoutBao(async () => {
      const stack = engine(fake);
      await stack.deploy(ProxmoxVm('row', declared));
      expect((await stack.verify(ProxmoxVm('row', declared), { all: true })).rows[0]).toMatchObject(
        { diff: 'noop' },
      );
    });
    expect(fake.writes()).toEqual([`POST nodes/${NODE}/qemu`]);
    expect(fake.calls.find((call) => call.method === 'POST')?.form['net0']).toBe(
      'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
    );
    expect(fake.calls.some((call) => call.path.includes('/tasks/'))).toBe(true);
  });

  test('a transitional task status keeps polling instead of aborting the create', async () => {
    // ⚠️ `GetNodeTaskStatusResponseStatus` types `status` as the closed union
    //   "running" | "stopped", but the runtime validator is `S.String` (distilled-proxmox's
    //   nodes.ts) -- a status word this endpoint's contract was never proven to exclude must
    //   keep polling rather than abort the whole create, since only "stopped" ends the task
    //   (2026-09-25 adversarial review; matches lxc-task.ts's own regression test).
    let exists = false;
    let polls = 0;
    const fake = fakePve((call) => {
      if (call.path.includes('/tasks/') && call.path.endsWith('/status')) {
        polls++;
        return polls === 1 ? { status: 'starting' } : { status: 'stopped', exitstatus: 'OK' };
      }
      if (isIndex(call)) return [];
      if (call.method === 'GET') return exists ? live : missing();
      exists = true;
      return UPID;
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      await stack.deploy(ProxmoxVm('row', props));
      expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
        diff: 'noop',
      });
    });
    expect(polls).toBe(2);
    expect(fake.writes()).toEqual([`POST nodes/${NODE}/qemu`]);
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

  test('drift on a declared field updates the config route, and only that field', async () => {
    // ⛔ THE "5-DEFAULT PUT" REGRESSION TEST. `name` is deliberately left UNDECLARED and deliberately
    //   NOT what qemu-form.ts's old default would have produced (`vm150`) -- the old `shape()` sent
    //   it (and `cores`/`sockets`/`onboot`) on every write regardless, silently resetting an
    //   undeclared field to its factory value. Only `memory` is declared here, so only `memory`
    //   may appear in the PUT body.
    const declared = { ...props, memory: 512 };
    let current: unknown = { ...live, memory: '256', name: 'a-name-nobody-declared' };
    const fake = fakePve((call) => {
      if (call.method === 'GET') return current;
      current = { ...(current as Record<string, unknown>), memory: '512' };
      return null;
    });
    await withoutBao(async () => {
      const stack = engine(fake);
      expect((await stack.verify(ProxmoxVm('row', declared), { all: true })).rows[0]).toMatchObject(
        { diff: 'update' },
      );
      await stack.deploy(ProxmoxVm('row', declared));
      expect((await stack.verify(ProxmoxVm('row', declared), { all: true })).rows[0]).toMatchObject(
        { diff: 'noop' },
      );
    });
    expect(fake.writes()).toEqual([`PUT nodes/${NODE}/qemu/${String(VMID)}/config`]);
    const put = fake.calls.find((call) => call.method === 'PUT');
    expect(put?.form).toEqual({ memory: '512' });
  });

  test('an unmanaged key smuggled past the types is refused before any write', async () => {
    const fake = fakePve((call) => (call.method === 'GET' ? live : null));
    // ⛔ `cipassword` IS TYPED `never` (qemu-props.ts): a cast is the only way in, exactly the
    //   scenario the type cannot guard against by itself. `formRefusals` is the runtime backstop.
    const smuggled = { ...props, cipassword: 'not-a-real-secret' } as unknown as VmProps;
    await withoutBao(async () => {
      await expect(engine(fake).deploy(ProxmoxVm('row', smuggled))).rejects.toThrow(
        /cipassword: not a config key this resource manages/,
      );
    });
    expect(fake.writes()).toEqual([]);
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
