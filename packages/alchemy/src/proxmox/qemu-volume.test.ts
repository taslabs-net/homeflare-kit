/**
 * Pure unit tests for `judgeDisk` — the red-team C1 fix on PR 297. No network, no fake PVE.
 * ⛔ WHAT THESE PIN: a "fresh" declaration (new-disk GiB, `storage:cloudinit`, or
 *   `storage:0,import-from=...`) never re-drifts against an existing live volume in the same slot;
 *   a genuine volume/storage swap is refused, never written; a size change is refused (no resize
 *   call exists here); an option-only change is written on the LIVE volume id and LIVE size.
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

/**
 * The disk-import convergence bug homeflare-proxmox PR 84's red team found (2026-09-26, real
 * fake-PVE engine): `judgeDisk` never recognized `<storage>:0,import-from=<volid>` as a new-disk
 * spelling, so it compared the literal volname `"0"` against PVE's live read-back of the real
 * `vm-<vmid>-disk-<n>` it allocated on import and refused -- on the very deploy that created the
 * disk, and on every plan after (Talos's `declareTalos` declares the import spelling every time,
 * never switches to the resolved volname). Each `judgeDisk` call below stands in for one PVE read
 * a real Talos deploy makes; none of them are a live PVE call.
 */
describe('the import-from create spelling converges (PR 84 red team)', () => {
  const IMPORT_DECLARED = 'cephtb4:0,import-from=cephfs-tb4:import/talos-factory.raw';

  test('create: post-write verification reads back the real volume PVE allocated', () => {
    // The deploy that creates the VM re-reads the config right after the PUT to verify it landed.
    // Before the fix this was refused (declared volname "0" vs live "vm-10000-disk-0").
    expect(judgeDisk('scsi0', IMPORT_DECLARED, 'cephtb4:vm-10000-disk-0,size=2G')).toEqual({});
  });

  test('re-plan: the same declared import spelling against the now-adopted live disk', () => {
    // A later `bun run plan` fabricates the same live read as create did; declared is unchanged
    // (declareTalos always emits import-from, never the resolved volname). Must still be a no-op.
    const verdict = judgeDisk('scsi0', IMPORT_DECLARED, 'cephtb4:vm-10000-disk-0,size=2G');
    expect(verdict.refuse).toBeUndefined();
    expect(verdict.put).toBeUndefined();
  });

  test('second deploy: PVE has since filled in defaults the fresh check must not treat as drift', () => {
    // pve-qemu-server fills in options nobody declared (ssd/discard/etc.). A "fresh" declaration
    // skips option comparison entirely, so this must be a no-op too -- not a PUT trying to "fix"
    // options that were never wrong, and not a resize of the placeholder "0" against the real size.
    const verdict = judgeDisk(
      'scsi0',
      IMPORT_DECLARED,
      'cephtb4:vm-10000-disk-0,size=2G,ssd=1,discard=on',
    );
    expect(verdict).toEqual({});
  });

  test('no resize is ever attempted for an import-from disk', () => {
    // The live size (2G, from the imported image) never appears in a `put` -- there is no `put` at
    // all, because `want.kind === 'fresh'` returns before size or options are ever inspected.
    expect(judgeDisk('scsi0', IMPORT_DECLARED, 'cephtb4:vm-10000-disk-0,size=200G')).toEqual({});
  });

  test('a volid with its own colon (storage:path) still parses as one fresh spelling', () => {
    // import-from points at cephfs-tb4:import/talos-factory.raw -- a second colon inside the value,
    // which a colon-anchored regex could truncate. Confirms the whole declared string is consumed.
    expect(
      judgeDisk(
        'scsi0',
        'cephtb4:0,import-from=cephfs-tb4:import/talos-factory.raw',
        'cephtb4:vm-10042-disk-0,size=2G',
      ),
    ).toEqual({});
  });

  test('a genuine size mismatch on an already-adopted volume is still refused', () => {
    // Not an import-from declaration: a plain adopted volume whose declared size disagrees with the
    // live one. Must still hit the existing no-resize refusal, unchanged by the new spelling.
    const verdict = judgeDisk(
      'scsi0',
      'cephtb4:vm-10000-disk-0,size=4G',
      'cephtb4:vm-10000-disk-0,size=2G',
    );
    expect(verdict.refuse).toMatch(/does not resize a disk/);
    expect(verdict.put).toBeUndefined();
  });

  test('volname "0" without import-from is not swept into the new "fresh" spelling', () => {
    // Guards NEW_IMPORT's literal ",import-from=" requirement: a coincidental "storage:0,k=v" (no
    // import-from) must still be judged as a real volume named "0", not treated as always-matching.
    const verdict = judgeDisk('scsi0', 'cephtb4:0,ssd=1', 'cephtb4:vm-10000-disk-0,size=2G');
    expect(verdict.refuse).toMatch(/is not the live vm-10000-disk-0/);
  });

  test('a mismatched storage on an import-from declaration is still refused, not silently matched', () => {
    // "fresh" only skips the volname/size/options checks -- the storage check above it still runs.
    const verdict = judgeDisk(
      'scsi0',
      'cephtb4:0,import-from=cephfs-tb4:import/talos-factory.raw',
      'local-zfs:vm-10000-disk-0,size=2G',
    );
    expect(verdict.refuse).toMatch(/the volume is on local-zfs, declared on cephtb4/);
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

  test('the import-from spelling parses as fresh, same shape as the other two', () => {
    expect(parseDisk('cephtb4:0,import-from=cephfs-tb4:import/talos-factory.raw')).toEqual({
      kind: 'fresh',
      options: new Map(),
      size: undefined,
      source: 'cephtb4',
      volname: '',
    });
  });
});
