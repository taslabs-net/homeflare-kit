/** Raw locks survive the SDK even though stored attributes omit them. All waits use TestClock. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as TestClock from 'effect/testing/TestClock';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { qemuHandlers } from './qemu-lifecycle.ts';

const props = {
  target: FAKE_TARGET,
  node: 'n2',
  vmid: 10000,
  scsi0: 'cephtb4:0,import-from=cephfs-tb4:import/talos.raw',
  diskSizesGiB: { scsi0: 64 },
};
const path = 'nodes/n2/qemu/10000';
const resizeTask = 'UPID:n2:2:0:0:qmresize:10000:test@pve!fake:';
const config = (size: string) => ({
  digest: 'a'.repeat(40),
  scsi0: `cephtb4:vm-10000-disk-0,size=${size}`,
});
const output = { ...props, config: config('4.15G') };

for (const lockState of ['persists', 'clears', 'clears-at-target', 'task-timeout'] as const) {
  test(`resize observes import lock: ${lockState}`, async () => {
    let reads = 0;
    let polls = 0;
    let resized = false;
    let locked = true;
    const fake = fakePve((call) => {
      if (call.path.includes('/tasks/')) {
        polls++;
        if (lockState === 'task-timeout') return { status: 'running' };
        resized = true;
        return { status: 'stopped', exitstatus: 'OK' };
      }
      if (call.path === `${path}/config`) {
        reads++;
        // First read belongs to reconcile; the next three are the raw resize lock checks.
        locked = lockState === 'persists' || reads <= 4;
        return {
          ...config(resized || (!locked && lockState === 'clears-at-target') ? '64G' : '4.15G'),
          ...(locked ? { lock: 'create' } : {}),
        };
      }
      if (call.path === `${path}/resize`) {
        expect(locked).toBe(false);
        expect(call.form).toEqual({ disk: 'scsi0', size: '64G' });
        return resizeTask;
      }
      throw new Error(`unexpected ${call.method} ${call.path}`);
    });
    const result = await withoutBao(() =>
      Effect.runPromise(
        Effect.gen(function* () {
          const worker = yield* qemuHandlers
            .reconcile({
              fqn: 'row',
              instanceId: 'row',
              news: props,
              olds: props,
              output,
            })
            .pipe(
              Effect.catchTag('QemuDiskResizeRefused', (error) => Effect.succeed(error)),
              Effect.catchTag('QemuRefusedError', (error) => Effect.succeed(error)),
              Effect.provide(fake.layer),
              Effect.forkChild,
            );
          while (reads < 2) yield* Effect.yieldNow;
          yield* TestClock.adjust('61 seconds');
          return yield* Fiber.join(worker);
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    );
    if (lockState === 'persists') {
      expect(result).toMatchObject({
        _tag: 'QemuDiskResizeRefused',
        disk: 'scsi0',
        message: 'scsi0: VM 10000 remains locked (create) after 60 observations; refusing resize',
      });
      expect(reads).toBe(61);
      expect(polls).toBe(0);
    } else if (lockState === 'task-timeout') {
      expect(result).toMatchObject({ _tag: 'QemuRefusedError' });
      expect(polls).toBe(57); // Three lock waits leave 57 task observations, not a new budget.
    } else {
      expect(result).toMatchObject({ config: { scsi0: config('64G').scsi0 } });
      expect(polls).toBe(lockState === 'clears' ? 1 : 0);
    }
    expect(fake.writes()).toEqual(
      lockState === 'persists' || lockState === 'clears-at-target' ? [] : [`PUT ${path}/resize`],
    );
  });
}
