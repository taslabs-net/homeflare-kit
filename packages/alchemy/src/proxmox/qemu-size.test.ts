import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_TARGET } from './fake-pve.ts';
import { form } from './qemu-form.ts';
import { judge } from './qemu-judge.ts';
import type { VmProps } from './qemu-props.ts';
import { diskBytes, validateDiskSizes } from './qemu-size.ts';

const props = {
  target: FAKE_TARGET,
  node: 'n2',
  vmid: 10000,
  scsi0: 'cephtb4:0,import-from=local:import/talos.raw',
};

test('size units compare capacity, while targets never become config form keys', () => {
  expect(diskBytes('ceph:disk,size=65536M')).toBe(64 * 1024 ** 3);
  expect(diskBytes('ceph:disk,size=4.15G')).toBe(4.15 * 1024 ** 3);
  expect(diskBytes('ceph:disk,size=4096K')).toBe(4 * 1024 ** 2);
  expect(diskBytes('ceph:disk,size=1T')).toBe(1024 ** 4);
  for (const size of ['NaNG', '0G', '-1G', '64GB', 'unknown']) {
    expect(diskBytes(`ceph:disk,size=${size}`)).toBeUndefined();
  }
  const news = { ...props, diskSizesGiB: { scsi0: 64 } };
  expect(form(news)).toEqual({ scsi0: props.scsi0 });
  expect(judge(news, { scsi0: 'cephtb4:vm-10000-disk-0,size=4.15G' })).toEqual({
    put: {},
    refuse: [],
    drift: ['diskSizesGiB.scsi0'],
  });
});

test('invalid targets, unsupported slots, undeclared slots and seed disks fail with a typed tag', async () => {
  const bad = [
    { diskSizesGiB: null },
    { diskSizesGiB: [] },
    { diskSizesGiB: '64G' },
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, '64'].map((scsi0) => ({
      diskSizesGiB: { scsi0 },
    })),
    { diskSizesGiB: { scsi31: 64 }, scsi31: 'cephtb4:1' },
    { diskSizesGiB: { scsi1: 64 } },
    { diskSizesGiB: { ide2: 64 }, ide2: 'cephtb4:cloudinit' },
    { diskSizesGiB: { ide2: 64 }, ide2: 'local:iso/image.iso,media=cdrom' },
  ];
  for (const extra of bad) {
    const result = await Effect.runPromise(
      validateDiskSizes({ ...props, ...extra } as unknown as VmProps).pipe(
        Effect.catchTag('QemuDiskResizeRefused', (error) => Effect.succeed(error._tag)),
      ),
    );
    expect(result).toBe('QemuDiskResizeRefused');
  }
});

test('an import source whose filename starts with cloudinit is still a regular disk', async () => {
  await Effect.runPromise(
    validateDiskSizes({
      ...props,
      scsi0: 'cephtb4:0,import-from=local:cloudinit-disk.raw',
      diskSizesGiB: { scsi0: 64 },
    }),
  );
});
