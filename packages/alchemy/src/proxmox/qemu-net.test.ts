/**
 * Pure unit tests for `sameNet`/`netWrite` — the red-team C1 fix on PR 297. No network, no fake PVE.
 * ⛔ WHAT THESE PIN: a MAC-less (or bare-model) declaration matches a live NIC with any MAC, and
 *   never generates a new one when written; an explicit MAC is compared and written as declared; a
 *   real drift elsewhere on the line (VLAN tag, bridge) still shows up.
 */
import { describe, expect, test } from 'bun:test';
import { netWrite, sameNet } from './qemu-net.ts';

const LIVE = 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=20';

describe('a MAC-less declaration', () => {
  test('bare model token matches a live NIC with any MAC: the measured C1 regression', () => {
    expect(sameNet('virtio,bridge=vmbr0,tag=20', LIVE)).toBe(true);
  });

  test('empty-value spelling matches too', () => {
    expect(sameNet('virtio=,bridge=vmbr0,tag=20', LIVE)).toBe(true);
  });

  test('writing it carries the LIVE mac forward, never regenerating one', () => {
    expect(netWrite('virtio,bridge=vmbr0,tag=21', LIVE)).toBe(
      'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=21',
    );
  });
});

describe('an explicit MAC', () => {
  test('a matching MAC is a noop', () => {
    expect(sameNet(LIVE, LIVE)).toBe(true);
  });

  test('a different MAC is real drift and is written as declared', () => {
    const declared = 'virtio=11:22:33:44:55:66,bridge=vmbr0,tag=20';
    expect(sameNet(declared, LIVE)).toBe(false);
    expect(netWrite(declared, LIVE)).toBe(declared);
  });
});

describe('a real change elsewhere on the line', () => {
  test('a different VLAN tag is drift even with the MAC substituted', () => {
    expect(sameNet('virtio,bridge=vmbr0,tag=42', LIVE)).toBe(false);
  });

  test('a different bridge is drift', () => {
    expect(sameNet('virtio,bridge=vmbr1,tag=20', LIVE)).toBe(false);
  });
});
