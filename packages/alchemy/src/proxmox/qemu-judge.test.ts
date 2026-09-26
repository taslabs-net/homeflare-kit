/**
 * Pure unit tests for `judge`/`identityRefusal` — red-team C1/I1 on PR 297. No network, no fake PVE.
 * ⛔ WHAT THESE PIN: only drifted keys are ever PUT (an unrelated field's drift does not drag the
 *   disk/NIC keys along, the failure mode a whole-form resend had); a vmid change is refused, never
 *   built as a second VM.
 */
import { describe, expect, test } from 'bun:test';
import { FAKE_TARGET } from './fake-pve.ts';
import { identityRefusal, judge } from './qemu-judge.ts';
import type { VmProps } from './qemu-props.ts';

const base = { node: 'pve1', target: FAKE_TARGET, vmid: 101 } as const;

describe('judge', () => {
  test('a fresh-spelled disk and a MAC-less NIC both settle against live, drifting nothing', () => {
    const props: VmProps = {
      ...base,
      ide2: 'cephtb4:cloudinit',
      net0: 'virtio,bridge=vmbr0,tag=20',
      scsi0: 'cephtb4:32',
    };
    const config = {
      ide2: 'cephtb4:vm-101-cloudinit,media=cdrom',
      net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=20',
      scsi0: 'cephtb4:vm-101-disk-0,size=32G',
    };
    expect(judge(props, config)).toEqual({ drift: [], put: {}, refuse: [] });
  });

  test('an unrelated field drifting does not drag the settled disk/NIC keys into the PUT', () => {
    const props: VmProps = {
      ...base,
      memory: 4096,
      net0: 'virtio,bridge=vmbr0,tag=20',
      scsi0: 'cephtb4:32',
    };
    const config = {
      memory: '2048',
      net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=20',
      scsi0: 'cephtb4:vm-101-disk-0,size=32G',
    };
    const change = judge(props, config);
    expect(change.drift).toEqual(['memory']);
    expect(change.put).toEqual({ memory: '4096' });
  });

  test('a scalar key not yet on the live config is put as declared', () => {
    const change = judge({ ...base, agent: true }, {});
    expect(change.put).toEqual({ agent: '1' });
  });
});

describe('identityRefusal', () => {
  test('no prior vmid: never refused (a fresh create)', () => {
    expect(identityRefusal(101, undefined)).toBeUndefined();
  });

  test('the same vmid: never refused', () => {
    expect(identityRefusal(101, 101)).toBeUndefined();
  });

  test('a changed vmid: refused, naming both -- a new resource, not an update', () => {
    expect(identityRefusal(151, 150)).toMatch(/vmid: 150 -> 151 is a different VM/);
  });
});
