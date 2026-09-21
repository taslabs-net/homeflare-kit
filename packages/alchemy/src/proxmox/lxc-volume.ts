/**
 * `rootfs` and `mpN`: what a declared mount point may change on a live guest, and how.
 *
 * ★ FOUR ANSWERS, AND ONLY ONE OF THEM IS A CONFIG WRITE. Options (`mp=`, `backup`, `acl`, …)
 *   change in place with `PUT …/config`. A size INCREASE goes through `PUT …/resize`. Everything
 *   else is refused with a sentence, because the only way PVE offers to get there loses the guest
 *   or its data:
 *   - a size DECREASE — `resize_vm` dies "unable to shrink disk size" (pve-container 6.1.14);
 *   - a storage MOVE — that is `pct move-volume`, a copy, not a config edit;
 *   - a DIFFERENT volume on the same storage — writing it would detach the live one to `unusedN`;
 *   - a bind or device mount — `check_ct_modify_config_perm` lets only `root@pam` write one, and an
 *     API token's user is `user@realm!token`, never `root@pam` (pve-access-control `verify_token`).
 *
 * ⛔ AN EXISTING VOLUME IS NEVER WRITTEN WITH THE NEW-DISK SPELLING. `tank:100` in a PUT means
 *   "allocate a fresh 100 GiB volume", and PVE then moves the volume the guest was using to
 *   `unusedN`. So a declared `tank:100,mp=/data` that matches a live
 *   `tank:subvol-100-disk-1,mp=/data,size=100G` compares EQUAL, and an options change on it is
 *   written with the LIVE volume id — the declaration's spelling is never sent back for a volume
 *   that exists.
 */
import { optionMap, pairs, sameMap } from './lxc-wire.ts';

/** PVE's `$NEW_DISK_RE`: `storage:SIZE`, SIZE in GiB, fractional allowed. */
const NEW_DISK = /^([^:\s]+):(\d+(?:\.\d+)?)$/;

const UNITS: Readonly<Record<string, number>> = {
  G: 1024 ** 3,
  K: 1024,
  M: 1024 ** 2,
  T: 1024 ** 4,
};

/** PVE's `parse_size`: `\d+(\.\d+)?[KMGT]?`, binary units, bare means bytes. */
export const sizeBytes = (text: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)([KMGT])?$/.exec(text.trim());
  if (match === null) return undefined;
  return Math.trunc(Number(match[1]) * (match[2] === undefined ? 1 : (UNITS[match[2]] ?? 1)));
};

export type Volume = {
  readonly kind: 'new' | 'volume' | 'bind' | 'device';
  /** `new`/`volume`: the storage id. `bind`/`device`: the host path. */
  readonly source: string;
  /** `volume` only: the name after `storage:`. */
  readonly volname: string;
  /** From `size=`, or the new-disk GiB. Undefined when neither says. */
  readonly size: number | undefined;
  /** The size as written, for a resize request. */
  readonly sizeText: string | undefined;
  /** Every other option, comparable. */
  readonly options: Map<string, string>;
};

/** PVE's `classify_mountpoint`, plus the new-disk spelling a declaration may use. */
export const parseVolume = (text: string): Volume => {
  const [first] = pairs(text, 'volume');
  const spec = first?.[0] === 'volume' ? first[1] : '';
  const options = optionMap(text, 'volume', 'volume');
  options.delete('volume');
  const sizeText = options.get('size');
  options.delete('size');
  const fresh = NEW_DISK.exec(spec);
  if (fresh !== null) {
    const gib = `${fresh[2] ?? '0'}G`;
    return {
      kind: 'new',
      options,
      size: sizeBytes(gib),
      sizeText: gib,
      source: fresh[1] ?? '',
      volname: '',
    };
  }
  const size = sizeText === undefined ? undefined : sizeBytes(sizeText);
  if (spec.startsWith('/')) {
    const kind = spec.startsWith('/dev/') ? 'device' : 'bind';
    return { kind, options, size, sizeText, source: spec, volname: '' };
  }
  const at = spec.indexOf(':');
  return {
    kind: 'volume',
    options,
    size,
    sizeText,
    source: at === -1 ? spec : spec.slice(0, at),
    volname: at === -1 ? '' : spec.slice(at + 1),
  };
};

/** What one mount point needs. At most one of `refuse` / `rootOnly` is set, and then nothing else. */
export type VolumeVerdict = {
  readonly refuse?: string;
  readonly rootOnly?: boolean;
  /** The value to PUT, built on the LIVE volume id. */
  readonly put?: string;
  /** An absolute size to hand `PUT …/resize`, which only ever grows. */
  readonly resize?: string;
};

export const isHostPath = (volume: Volume) => volume.kind === 'bind' || volume.kind === 'device';

/**
 * The value to PUT for an options change: live volume, declared options, LIVE size.
 * ⚠️ THE LIVE SIZE, NOT THE DECLARED ONE: `size=` is written by the resize call itself, and a PUT
 *   that sent the declared size ahead of the resize would record a size the volume does not have.
 */
const rewrite = (live: Volume, declared: Volume) => {
  const parts = [`${live.source}:${live.volname}`];
  for (const [key, value] of declared.options) parts.push(`${key}=${value}`);
  if (live.sizeText !== undefined) parts.push(`size=${live.sizeText}`);
  return parts.join(',');
};

export const judgeVolume = (key: string, declared: string, live: string): VolumeVerdict => {
  const want = parseVolume(declared);
  const have = parseVolume(live);
  if (isHostPath(want) || isHostPath(have)) {
    const same =
      want.kind === have.kind && want.source === have.source && sameMap(want.options, have.options);
    return same ? {} : { rootOnly: true };
  }
  if (want.source !== have.source) {
    return {
      refuse:
        `${key}: the volume is on ${have.source}, declared on ${want.source}. Moving it is ` +
        '`pct move-volume` (a copy), not a config update -- move it by hand, then declare it.',
    };
  }
  if (want.kind === 'volume' && want.volname !== have.volname) {
    return {
      refuse:
        `${key}: declared volume ${want.volname} is not the live ${have.volname}. Writing it would ` +
        'detach the live volume to unusedN; attach or swap volumes by hand.',
    };
  }
  let resize: string | undefined;
  if (want.size !== undefined && have.size !== undefined && want.size !== have.size) {
    if (want.size < have.size) {
      return {
        refuse:
          `${key}: declared ${want.sizeText ?? '?'} is smaller than the live ` +
          `${have.sizeText ?? '?'}. PVE cannot shrink a container volume ("unable to shrink disk ` +
          'size"), and replacing the guest to get there is not an update this resource makes.',
      };
    }
    resize = want.sizeText;
  }
  const put = sameMap(want.options, have.options) ? undefined : rewrite(have, want);
  return {
    ...(put === undefined ? {} : { put }),
    ...(resize === undefined ? {} : { resize }),
  };
};
