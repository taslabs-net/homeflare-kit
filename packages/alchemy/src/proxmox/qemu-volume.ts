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
 *   other two: an `import-from` disk also counts as `kind: 'fresh'`, which already matches whatever
 *   is live unconditionally when nothing else is declared (see `want.kind === 'fresh'` below) -- no
 *   special-casing of the live side needed.
 * ⛔ IMPORT-FROM IMPORTS ONLY AT CREATE. Changing just the `import-from=` *source* (e.g. bumping a
 *   factory image path) on an already-created disk still reads as `noop`: PVE does not re-import an
 *   existing volume, and this resource has no rebuild-the-disk path. That is correct for Talos, which
 *   upgrades in place through `talosctl`, not by recreating its disk -- a caller that DOES want a
 *   fresh import on image change must delete and recreate the row itself.
 * ⛔ LAND RED TEAM (2026-09-26): OPTIONS DECLARED ALONGSIDE `import-from` MUST STILL BE ENFORCED, AND
 *   MUST BE RECOGNIZED REGARDLESS OF WHERE `import-from` SITS IN THE LIST. The first cut matched
 *   `import-from` only when it came immediately after `:0,`, via a regex whose `.+` then swallowed
 *   every option after it uncompared (silently never written) while any option declared BEFORE it
 *   (`cephtb4:0,iothread=1,import-from=...`) missed the regex entirely and fell to the `volume`
 *   branch, comparing literal volname `"0"` against the live real one forever -- REFUSED, same
 *   stranded-disk failure this file exists to fix, just for a different option order. Fixed by
 *   folding the import check into the general `storage:volname,k=v,...` parse below: ANY declaration
 *   whose volname is the literal `"0"` and whose options include an `import-from` key is `fresh`,
 *   with `import-from` itself dropped and every other declared option carried through for
 *   `judgeDisk` to enforce (see its `want.kind === 'fresh'` branch) -- independent of option order.
 * ⛔ NO RESIZE IS MADE BY A CONFIG PUT. Before 2026-10-05 this resource did not call the resize
 *   endpoint at all. `diskSizesGiB` now drives it separately (qemu-resize.ts), after import;
 *   `size=` inside an adopted volume string still describes its observed size, never a resize.
 *   A mismatch there is refused so a config PUT cannot record capacity the disk does not have.
 * ⚠️ OPTIONS BEYOND `size` ARE COMPARED AS A WHOLE, NOT KEY BY KEY, FOR AN ADOPTED `volume` -- BUT AS
 *   A SUBSET FOR A `fresh` IMPORT. Unlike lxc-volume.ts, this file does not model pve-qemu-server's
 *   per-option defaults (`ssd`, `discard`, `iothread`, …) — that table is unverified here. For an
 *   already-adopted volume, any options difference from live is real drift and gets written in full,
 *   exactly as the whole-string comparison this replaces already did. An `import-from` disk cannot
 *   use that same whole-map comparison: nobody declares PVE's post-import defaults, so comparing the
 *   full map would treat every default PVE fills in as drift and rewrite the disk on every plan (the
 *   builder's "second deploy" test below pins this). So a `fresh` import instead checks only the
 *   options the caller actually declared against live, ignoring any live-only keys, and PUTs the
 *   declared options (not merged with what live already has) when one of them disagrees.
 */
import { sameMap } from './lxc-wire.ts';

/** PVE's own new-disk spelling: `storage:SIZE`, SIZE in GiB, fractional allowed. */
const NEW_DISK = /^([^:\s]+):(\d+(?:\.\d+)?)$/;
/** The `ideN` cloud-init-drive spelling — QEMU only, no GiB, no LXC equivalent. */
const NEW_CLOUDINIT = /^([^:\s]+):cloudinit$/;

export type Disk = {
  /** `fresh`: a new-disk spelling (`storage:GiB`, `storage:cloudinit`, or `storage:0,import-from=...`
   *  possibly with more options). `volume`: an existing volume, `storage:volname,...`. */
  readonly kind: 'fresh' | 'volume';
  readonly source: string;
  readonly volname: string;
  readonly size: string | undefined;
  readonly options: Map<string, string>;
};

/**
 * `storage:volname,k=v,...` (or one of the "fresh" spellings) into its comparable parts.
 * ⚠️ THE IMPORT SPELLING IS DETECTED AFTER THE GENERAL SPLIT, NOT BY ITS OWN REGEX: `import-from`'s
 *   value can itself contain a colon (e.g. `cephfs-tb4:import/talos-factory.raw`) and other options
 *   can come before or after it, so a regex anchored on `:0,import-from=` right after the colon (as
 *   the first cut had) misses that ordering and swallows everything after it into one opaque match.
 *   Splitting on commas like any `volume` spelling first, THEN checking for a literal `"0"` volname
 *   plus an `import-from` key among the parsed options, catches every ordering and keeps every other
 *   declared option (`iothread=1`, `discard=on`, …) visible to `judgeDisk` instead of swallowed.
 */
export const parseDisk = (text: string): Disk => {
  const bare = NEW_DISK.exec(text) ?? NEW_CLOUDINIT.exec(text);
  if (bare !== null) {
    return {
      kind: 'fresh',
      options: new Map(),
      size: undefined,
      source: bare[1] ?? '',
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
  if (volname === '0' && options.has('import-from')) {
    options.delete('import-from');
    return { kind: 'fresh', options, size: undefined, source, volname: '' };
  }
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
  // ⛔ A "fresh" declaration never re-triggers create: PVE holds a real volume in this slot already,
  //   and re-sending storage:GiB / storage:cloudinit / storage:0,import-from=... as the PUT value
  //   would allocate a SECOND volume and park the live one at unusedN (the header's ⛔, ported from
  //   lxc-volume.ts's own). So a `fresh` PUT, when one is needed, is always built from the LIVE
  //   volume id (`have.volname`/`have.size`), never the declared placeholder -- same as `volume`.
  // ⚠️ ONLY THE OPTIONS THE CALLER ACTUALLY DECLARED ARE CHECKED (a subset, not `sameMap`): nobody
  //   declares PVE's post-import defaults, so an empty `want.options` (plain import-from, nothing
  //   else declared) is always a noop no matter what live has filled in, and a non-empty one is
  //   compared key-by-key against live, ignoring any key live has that the caller never declared.
  if (want.kind === 'fresh') {
    if (want.options.size === 0) return {};
    if ([...want.options].every(([k, v]) => have.options.get(k) === v)) return {};
    return { put: printOptions(have.source, have.volname, want.options, have.size) };
  }
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
        'not resize a disk through config -- omit size= and declare a diskSizesGiB target instead.',
    };
  }
  if (sameMap(want.options, have.options)) return {};
  // ⚠️ THE LIVE SIZE, NOT THE DECLARED ONE — see the header's ⛔ on why no resize happens here.
  return { put: printOptions(have.source, have.volname, want.options, have.size) };
};
