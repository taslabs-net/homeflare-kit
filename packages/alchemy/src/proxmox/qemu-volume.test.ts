/**
 * Pure unit tests for `judgeDisk` — the red-team C1 fix on PR 297. No network, no fake PVE.
 * ⛔ WHAT THESE PIN: a "fresh" declaration (new-disk GiB, or `storage:cloudinit`) never re-drifts
 *   against an existing live volume in the same slot; a genuine volume/storage swap is refused,
 *   never written; a size change is refused (no resize call exists here); an option-only change is
 *   written on the LIVE volume id and LIVE size.
 */
import { describe, expect, test } from 'bun:test';
import { judgeDisk, parseDisk } from './qemu-volume.ts';

describe('a "fresh" declaration matches any existing volume in its slot', () => {
  test('new-disk GiB spelling: the measured C1 regression', () => {
    expect(judgeDisk('scsi0', 'cephtb4:32', 'cephtb4:vm-101-disk-0,size=32G')).toEqual({});
  });

  test('cloud-init spelling, QEMU-only: no LXC equivalent', () => {
    expect(judgeDisk('ide2', 'cephtb4:cloudinit', 'cephtb4:vm-101-cloudinit,media=cdrom')).toEqual(
      {},
    );
  });
});

describe('an existing-volume declaration', () => {
  const live = 'cephtb4:vm-101-disk-0,size=32G,ssd=1';

  test('matching options is a noop', () => {
    expect(judgeDisk('scsi0', live, live)).toEqual({});
  });

  test('a different storage is refused, never written', () => {
    const verdict = judgeDisk('scsi0', 'other:vm-101-disk-0,size=32G,ssd=1', live);
    expect(verdict.refuse).toMatch(/the volume is on cephtb4, declared on other/);
    expect(verdict.put).toBeUndefined();
  });

  test('a different volume on the same storage is refused: it would detach the live one', () => {
    const verdict = judgeDisk('scsi0', 'cephtb4:vm-101-disk-9,size=32G', live);
    expect(verdict.refuse).toMatch(/detach the live volume to unusedN/);
  });

  test('a declared size difference is refused: this resource does not resize', () => {
    const verdict = judgeDisk('scsi0', 'cephtb4:vm-101-disk-0,size=64G,ssd=1', live);
    expect(verdict.refuse).toMatch(/does not resize a disk/);
  });

  test('an option-only change writes the LIVE volume id and LIVE size, not the declared ones', () => {
    const verdict = judgeDisk('scsi0', 'cephtb4:vm-101-disk-0,size=32G,ssd=0', live);
    expect(verdict.put).toBe('cephtb4:vm-101-disk-0,ssd=0,size=32G');
  });

  test('the cloud-init slot has no size to carry: the PUT omits it rather than writing size=', () => {
    const cloudinitLive = 'cephtb4:vm-101-cloudinit,media=cdrom';
    const verdict = judgeDisk(
      'ide2',
      'cephtb4:vm-101-cloudinit,media=cdrom,readonly=1',
      cloudinitLive,
    );
    expect(verdict.put).toBe('cephtb4:vm-101-cloudinit,media=cdrom,readonly=1');
  });
});

describe('parseDisk', () => {
  test('a bare new-disk spelling has no volname and no size stored as an option', () => {
    expect(parseDisk('cephtb4:32')).toEqual({
      kind: 'fresh',
      options: new Map(),
      size: undefined,
      source: 'cephtb4',
      volname: '',
    });
  });

  test('an existing volume splits size out of the options map', () => {
    const disk = parseDisk('cephtb4:vm-101-disk-0,size=32G,ssd=1');
    expect(disk.kind).toBe('volume');
    expect(disk.volname).toBe('vm-101-disk-0');
    expect(disk.size).toBe('32G');
    expect(disk.options).toEqual(new Map([['ssd', '1']]));
  });
});
