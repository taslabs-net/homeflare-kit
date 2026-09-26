/**
 * Pure unit tests for the declared-keys model: no network, no fake PVE. The engine-level proof
 * that an unmanaged key is refused before any write lives in qemu-lifecycle.test.ts, alongside
 * the node-pinned-refusal and 5-default-PUT regression tests.
 */
import { describe, expect, test } from 'bun:test';
import { formRefusals } from './qemu-form.ts';
import {
  type VmProps,
  declaredKeys,
  indexedKey,
  isManagedKey,
  storedConfig,
  wireValue,
} from './qemu-props.ts';
import { FAKE_TARGET } from './fake-pve.ts';

const base = { node: 'pve1', target: FAKE_TARGET, vmid: 150 } as const;

describe('declaredKeys', () => {
  test('excludes identity fields and undeclared ones, and sorts what is left', () => {
    const props: VmProps = { ...base, cores: 2, memory: 4096 };
    expect(declaredKeys(props)).toEqual(['cores', 'memory']);
  });

  test('an empty declaration manages nothing — the base for every "adopt as-is" test', () => {
    expect(declaredKeys(base as unknown as VmProps)).toEqual([]);
  });
});

describe('isManagedKey / indexedKey', () => {
  test('the scalar and indexed families Talos needs are all managed', () => {
    for (const key of [
      'agent',
      'boot',
      'cpu',
      'memory',
      'scsihw',
      'scsi0',
      'net0',
      'ide2',
      'ipconfig0',
      'serial0',
    ]) {
      expect(isManagedKey(key)).toBe(true);
    }
  });

  test('⛔ no secret prop exists: cipassword and machine are never managed keys', () => {
    expect(isManagedKey('cipassword')).toBe(false);
    expect(isManagedKey('machine')).toBe(false);
  });

  test('an out-of-range index is not a PVE key this resource recognises', () => {
    expect(indexedKey('scsi31')).toBeUndefined(); // pve-qemu-server's own 0-30
    expect(indexedKey('ide4')).toBeUndefined(); // 0-3
    expect(indexedKey('scsi03')).toBeUndefined(); // not how PVE spells it
  });
});

describe('wireValue / storedConfig', () => {
  test('booleans go as 1/0, everything else as String()', () => {
    expect(wireValue(true)).toBe('1');
    expect(wireValue(false)).toBe('0');
    expect(wireValue(4096)).toBe('4096');
    expect(wireValue('local-zfs:32')).toBe('local-zfs:32');
  });

  test('storedConfig is an allowlist: an unmanaged live key never reaches state', () => {
    const live = { cipassword: 'leaked', cores: 2, digest: 'a'.repeat(40), scsi0: 'local:32' };
    expect(storedConfig(live)).toEqual({ cores: '2', scsi0: 'local:32' });
  });
});

describe('formRefusals — the runtime backstop behind the never-typed props', () => {
  test('a clean declaration is refused nothing', () => {
    expect(formRefusals({ ...base, agent: true, net0: 'bridge=vmbr0,tag=42' })).toEqual([]);
  });

  test('a key smuggled past the types is named, not silently dropped or silently sent', () => {
    const smuggled = { ...base, cipassword: 'x', machine: 'q35' } as unknown as VmProps;
    expect(formRefusals(smuggled)).toEqual([
      'cipassword: not a config key this resource manages (vmid 150).',
      'machine: not a config key this resource manages (vmid 150).',
    ]);
  });
});
