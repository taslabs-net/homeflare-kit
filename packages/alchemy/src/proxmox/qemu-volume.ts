/**
 * `scsiN` and `ideN`: what a declared disk may change on a live VM, and how.
 *
 * ★ PORTED FROM lxc-volume.ts (2026-09-26, red-team C1 on PR 297): pve-qemu-server shares the same
 *   "new-disk spelling" rule pve-container has. `storage:GiB` in a PUT means "allocate a fresh
 *   volume" — so a declared `cephtb4:32` that already has a live `cephtb4:vm-101-disk-0,size=32G`
 *   in that slot must compare EQUAL, never be re-sent. Measured by the builder's red team: resending
 *   it allocated a second volume every deploy and parked the guest's real disk at `unusedN` (or left
 *   the swap pending on a running boot disk until the next reboot).
 * ⚠️ `ideN` HAS A SECOND NEW-VOLUME SPELLING QEMU DOES NOT SHARE WITH LXC: `<storage>:cloudinit`
 *   creates a fresh cloud-init seed drive; the live slot then reads back
 *   `<storage>:vm-<vmid>-cloudinit,media=cdrom`. Both spellings compare equal to an existing volume
 *   already in the slot, for the same reason `storage:GiB` does.
 * ⛔ A THIRD NEW-VOLUME SPELLING, FOUND BY homeflare-proxmox PR 84's RED TEAM (2026-09-26, real
 *   fake-PVE engine): `<storage>:0,import-from=<volid>` imports a disk from another volume or a
 *   downloaded image at create time. Before this fix it fell through to the `volume` branch below
 *   (it has a comma, so `NEW_DISK` never matched it), so `want.volname` stayed the literal `"0"`
 *   forever while PVE's live read-back reported the real `vm-<vmid>-disk-<n>` it allocated on
 *   import -- a volname mismatch, REFUSED. That refusal fired on the very deploy that created the
 *   disk (post-write verification reads the config right back) and on every plan after, because
 *   the declared value is `import-from=...` again each time (Talos's `declareTalos` recomputes it
 *   from the download resource, never switches to the resolved volname). Fixed the same way as the
 *   other two: `NEW_IMPORT` below also counts as `kind: 'fresh'`, which already matches whatever is
 *   live unconditionally (line ~103) -- no special-casing of the live side needed.
 * ⛔ NO RESIZE IS MADE HERE. lxc-volume.ts drives a second endpoint (`PUT .../resize`) this resource
 *   does not call — Talos's disks are declared once at their create size. A size difference between
 *   two already-adopted volume declarations is REFUSED with the `qm resize` to run by hand, never
 *   guessed at or silently written.
 * ⚠️ OPTIONS BEYOND `size` ARE COMPARED AS A WHOLE, NOT KEY BY KEY. Unlike lxc-volume.ts, this file
 *   does not model pve-qemu-server's per-option defaults (`ssd`, `discard`, `iothread`, …) — that
 *   table is unverified here. So an option difference is real drift and gets written, exactly as the
 *   whole-string comparison this replaces already did; only the three "new volume" spellings and the
 *   live volume id/size are special-cased, which is the minimum that fixes the measured bug.
 */
import { sameMap } from './lxc-wire.ts';

/** PVE's own new-disk spelling: `storage:SIZE`, SIZE in GiB, fractional allowed. */
const NEW_DISK = /^([^:\s]+):(\d+(?:\.\d+)?)$/;
/** The `ideN` cloud-init-drive spelling — QEMU only, no GiB, no LXC equivalent. */
const NEW_CLOUDINIT = /^([^:\s]+):cloudinit$/;
/**
 * The create-time import spelling: `<storage>:0,import-from=<volid>` (`<volid>` can itself contain
 * a colon, e.g. `cephfs-tb4:import/talos-factory.raw`, hence `.+` rather than a no-colon class).
 * `0` is PVE's literal placeholder size for "read the real size off the imported image" — never a
 * declared GiB figure, so it must not be compared against a live `size=`.
 */
const NEW_IMPORT = /^([^:\s]+):0,import-from=.+$/;

export type Disk = {
  /** `fresh`: any of the three new-disk spellings above. `volume`: an existing volume, `storage:volname,...`. */
  readonly kind: 'fresh' | 'volume';
  readonly source: string;
  readonly volname: string;
  readonly size: string | undefined;
  readonly options: Map<string, string>;
};

/** `storage:volname,k=v,...` (or one of the three "fresh" spellings) into its comparable parts. */
export const parseDisk = (text: string): Disk => {
  const fresh = NEW_DISK.exec(text) ?? NEW_CLOUDINIT.exec(text) ?? NEW_IMPORT.exec(text);
  if (fresh !== null) {
    return {
      kind: 'fresh',
      options: new Map(),
      size: undefined,
      source: fresh[1] ?? '',
      volname: '',
    };
  }
  const [first, ...rest] = text.split(',');
  const at = (first ?? '').indexOf(':');
  const source = at === -1 ? (first ?? '') : (first ?? '').slice(0, at);
  const volname = at === -1 ? '' : (first ?? '').slice(at + 1);
  const options = new Map(
    rest.map((part): [string, string] => {
      const eq = part.indexOf('=');
      return eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)];
    }),
  );
  const size = options.get('size');
  options.delete('size');
  return { kind: 'volume', options, size, source, volname };
};

export type DiskVerdict = {
  readonly refuse?: string;
  /** The value to PUT, built on the LIVE volume id and LIVE size — never the declared spelling. */
  readonly put?: string;
};

/**
 * A map back to `key=value,...` — mirrors lxc-wire.ts's `printMap`.
 * ⚠️ `size` OMITTED WHEN THE LIVE SLOT HAS NONE (the cloud-init drive: no GiB figure to carry).
 *   Writing `size=` empty is not a value PVE's own parser accepts.
 */
const printOptions = (
  source: string,
  volname: string,
  options: Map<string, string>,
  size: string | undefined,
) =>
  [
    `${source}:${volname}`,
    ...[...options].map(([k, v]) => `${k}=${v}`),
    ...(size === undefined ? [] : [`size=${size}`]),
  ].join(',');

export const judgeDisk = (key: string, declared: string, live: string): DiskVerdict => {
  const want = parseDisk(declared);
  const have = parseDisk(live);
  if (want.source !== have.source) {
    return {
      refuse:
        `${key}: the volume is on ${have.source}, declared on ${want.source}. Moving a disk ` +
        'between storages is not an update this resource makes -- move it by hand, then declare it.',
    };
  }
  // ⛔ A "fresh" declaration always matches an existing volume already in this slot: PVE holds one
  //   there, and re-sending storage:GiB / storage:cloudinit would allocate a SECOND volume and park
  //   the live one at unusedN (the header's ⛔, ported from lxc-volume.ts's own).
  if (want.kind === 'fresh') return {};
  if (want.volname !== have.volname) {
    return {
      refuse:
        `${key}: declared volume ${want.volname} is not the live ${have.volname}. Writing it ` +
        'would detach the live volume to unusedN; attach or swap volumes by hand.',
    };
  }
  if (want.size !== undefined && have.size !== undefined && want.size !== have.size) {
    return {
      refuse:
        `${key}: declared size ${want.size} differs from the live ${have.size}. This resource does ` +
        'not resize a disk -- grow it by hand (`qm resize`) and declare the size it then reports.',
    };
  }
  if (sameMap(want.options, have.options)) return {};
  // ⚠️ THE LIVE SIZE, NOT THE DECLARED ONE — see the header's ⛔ on why no resize happens here.
  return { put: printOptions(have.source, have.volname, want.options, have.size) };
};
