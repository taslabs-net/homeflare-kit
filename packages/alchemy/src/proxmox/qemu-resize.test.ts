/** Real SDK and Alchemy engine, fake PVE only: imports must finish before resize or power-on. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { qemuHandlers } from './qemu-lifecycle.ts';
import { ProxmoxVm, ProxmoxVmProvider } from './qemu.ts';

const base = { target: FAKE_TARGET, node: 'n2', vmid: 10000 };
const props = {
  ...base,
  scsi0: 'cephtb4:0,import-from=cephfs-tb4:import/talos.raw',
  diskSizesGiB: { scsi0: 64 },
};
const path = 'nodes/n2/qemu/10000';
const importTask = 'UPID:n2:1:0:0:qmcreate:10000:test@pve!fake:';
const resizeTask = 'UPID:n2:2:0:0:qmresize:10000:test@pve!fake:';
const config = (size: string) => ({
  digest: 'a'.repeat(40),
  scsi0: `cephtb4:vm-10000-disk-0,size=${size}`,
});
const output = { ...base, config: config('4.15G') };
const missing = () =>
  Response.json(
    {
      data: null,
      message: "Configuration file 'nodes/n2/qemu-server/10000.conf' does not exist\n",
    },
    { status: 500 },
  );

test('import completes, allocated size is read, resize completes, then reconciliation returns', async () => {
  let created = false;
  let imported = false;
  let resized = false;
  const fake = fakePve((call) => {
    if (call.path.startsWith('cluster/resources')) return [];
    if (call.path.includes(encodeURIComponent(importTask))) {
      imported = true;
      return { status: 'stopped', exitstatus: 'OK' };
    }
    if (call.path.includes(encodeURIComponent(resizeTask))) {
      resized = true;
      return { status: 'stopped', exitstatus: 'OK' };
    }
    if (call.path === `${path}/config`)
      return created ? config(resized ? '64G' : '4.15G') : missing();
    if (call.method === 'POST') {
      expect(call.form['diskSizesGiB']).toBeUndefined();
      expect(call.form['start']).toBeUndefined();
      expect(call.form['scsi0']).toBe(props.scsi0);
      created = true;
      return importTask;
    }
    if (call.path === `${path}/resize`) {
      expect(imported).toBe(true);
      expect(call.form).toEqual({ disk: 'scsi0', size: '64G' });
      return resizeTask;
    }
    throw new Error(`unexpected ${call.method} ${call.path}`);
  });
  await withoutBao(async () => {
    const stack = engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)));
    await stack.deploy(ProxmoxVm('row', props));
    expect(resized).toBe(true); // The caller's separate power-on step can proceed only now.
    await stack.deploy(ProxmoxVm('row', props));
    expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
      diff: 'noop',
    });
  });
  expect(fake.writes()).toEqual(['POST nodes/n2/qemu', `PUT ${path}/resize`]);
  const resizeIndex = fake.calls.findIndex((call) => call.path === `${path}/resize`);
  expect(fake.calls[resizeIndex - 1]?.path).toBe(`${path}/config`);
});

for (const initialSize of ['4250M', '63.9999999990687G']) {
  test(`recovery of an imported disk at ${initialSize} grows once without re-importing`, async () => {
    let size = initialSize;
    const fake = fakePve((call) => {
      if (call.path.includes('/tasks/')) {
        size = '64G';
        return { status: 'stopped', exitstatus: 'OK' };
      }
      if (call.method === 'GET') return config(size);
      if (call.path === `${path}/resize`) return resizeTask;
      throw new Error('must not re-import');
    });
    await withoutBao(async () => {
      const stack = engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)));
      expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
        diff: 'update',
      });
      await stack.deploy(ProxmoxVm('row', props));
      await stack.deploy(ProxmoxVm('row', props));
    });
    expect(fake.writes()).toEqual([`PUT ${path}/resize`]);
  });
}

test('equal and larger live disks are no-ops, including equivalent units', async () => {
  for (const size of ['64G', '65536M', '128G', '1T', '64.0000000009313G']) {
    const fake = fakePve(() => config(size));
    await withoutBao(async () => {
      const stack = engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)));
      await stack.deploy(ProxmoxVm('row', props));
      expect((await stack.verify(ProxmoxVm('row', props), { all: true })).rows[0]).toMatchObject({
        diff: 'noop',
      });
    });
    expect(fake.writes()).toEqual([]);
  }
});

test('a declared decrease is catchTag-able and refuses both diff and reconcile before writes', async () => {
  const fake = fakePve(() => config('64G'));
  const news = { ...props, diskSizesGiB: { scsi0: 32 } };
  await withoutBao(async () => {
    for (const operation of [
      qemuHandlers.diff({ news, olds: props, output }).pipe(Effect.asVoid),
      qemuHandlers
        .reconcile({ fqn: 'row', instanceId: 'row', news, olds: props, output })
        .pipe(Effect.asVoid),
    ]) {
      const result = await Effect.runPromise(
        operation.pipe(
          Effect.catchTag('QemuDiskResizeRefused', (error) => Effect.succeed(error.message)),
          Effect.provide(fake.layer),
        ),
      );
      expect(result).toContain('refusing shrink');
    }
  });
  expect(fake.calls).toEqual([]);
});

test('failed resize tasks and false success never claim the target was reached', async () => {
  for (const exitstatus of ['disk resize failed', 'OK']) {
    const fake = fakePve((call) => {
      if (call.path.includes('/tasks/')) return { status: 'stopped', exitstatus };
      if (call.method === 'GET') return config('4.15G');
      return resizeTask;
    });
    await withoutBao(async () => {
      const stack = engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)));
      await expect(stack.deploy(ProxmoxVm('row', props))).rejects.toThrow(
        exitstatus === 'OK' ? /diskSizesGiB.scsi0 still differ/ : /disk resize failed/,
      );
    });
    expect(fake.writes()).toEqual([`PUT ${path}/resize`]);
  }
});

test('unreadable live capacity blocks unrelated config writes too', async () => {
  const fake = fakePve(() => config('unknown'));
  await withoutBao(async () => {
    const result = await Effect.runPromise(
      qemuHandlers
        .diff({
          news: { ...props, memory: 8192 },
          olds: props,
          output,
        })
        .pipe(
          Effect.catchTag('QemuDiskResizeRefused', (error) => Effect.succeed(error._tag)),
          Effect.provide(fake.layer),
        ),
    );
    expect(result).toBe('QemuDiskResizeRefused');
  });
  expect(fake.writes()).toEqual([]);
});

test('SDK resize failures preserve generated tags and never start a task or retry a write', async () => {
  const fake = fakePve((call) =>
    call.method === 'GET'
      ? config('4.15G')
      : Response.json({ data: null, message: 'permission denied' }, { status: 403 }),
  );
  await withoutBao(async () => {
    const result = await Effect.runPromise(
      qemuHandlers
        .reconcile({
          fqn: 'row',
          instanceId: 'row',
          news: props,
          olds: props,
          output,
        })
        .pipe(
          Effect.catchTag('Forbidden', (error) => Effect.succeed(error._tag)),
          Effect.provide(fake.layer),
        ),
    );
    expect(result).toBe('Forbidden');
  });
  expect(fake.writes()).toEqual([`PUT ${path}/resize`]);
  expect(fake.calls.some((call) => call.path.includes('/tasks/'))).toBe(false);
});
