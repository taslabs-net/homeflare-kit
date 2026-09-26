/**
 * What a `Proxmox.Vm` declaration says, and what its state keeps.
 *
 * ★ THE SAME "DECLARED KEYS" MODEL AS `Proxmox.Lxc` (lxc-props.ts, joined 2026-09-21): an
 *   undeclared key is UNMANAGED — never sent, never compared, never overwritten. Adopting a live
 *   VM is then a paste of its config, not a translation of it, and the wire spelling is PVE's own
 *   (`scsi0`, `net0`, `ipconfig0`, as `pvesh get .../qemu/{vmid}/config` prints them).
 *
 * ⛔ THIS REPLACES THE "5-DEFAULT PUT". Before 2026-09-26, `qemu-form.ts`'s `shape()` sent
 *   `cores`/`memory`/`name`/`onboot`/`sockets` on EVERY write with a hard default substituted for
 *   whichever of the five was left undeclared, so declaring only `memory: 4096` on an adopted VM
 *   still PUT `name: 'vm101'` and `sockets: '1'` over whatever the guest actually had. Harmless
 *   while `ProxmoxVm` stayed Provider-only (nothing declared it), load-bearing the moment Talos
 *   does. `declaredKeys` below is the fix: a field absent from the declaration is never read,
 *   never compared and never written — see qemu-form.ts's `form()`.
 *
 * ⛔ NO SECRET IS A PROP. `cipassword` (cloud-init's password) is write-only and Alchemy persists
 *   props in plaintext (this estate's state store is dumped nightly) — typed `never`, exactly
 *   like lxc-props.ts's `password`. A VM that needs a login uses `sshkeys`-free image defaults or
 *   an out-of-band secret; this resource never carries one.
 * ⛔ `machine` IS NEVER A PROP EITHER. It pins the emulated chipset/firmware revision a guest boots
 *   against; PVE already resolves it from the node's installed QEMU version, and declaring it here
 *   would fight every future node upgrade instead of tracking it. Typed `never` for the same
 *   reason `cipassword` is: a cast is the only way in, and this file's helpers below never read
 *   an unmanaged key onto the wire regardless.
 */
import type { WithTarget } from './resource.ts';

/** A PVE boolean as pvesh prints it (`1`) or as TypeScript writes it (`true`). The same value. */
export type PveFlag = boolean | 0 | 1;

export interface VmProps extends WithTarget {
  /** ⛔ This resource never migrates: qemu-read.ts refuses a VM found on another node. */
  node: string;
  /** ⛔ Cluster-wide, and shared with LXC. See qemu.ts's header. */
  vmid: number;
  name?: string;
  /** MiB. */
  memory?: number;
  cores?: number;
  sockets?: number;
  /** Emulated CPU type, e.g. `host`. */
  cpu?: string;
  onboot?: PveFlag;
  /** The QEMU guest agent. Talos reports its addresses through it once this is enabled. */
  agent?: PveFlag;
  /** `order=scsi0;ide2;net0`. */
  boot?: string;
  /** e.g. `virtio-scsi-single`. */
  scsihw?: string;
  /**
   * `local-zfs:32` to create a new volume, or the live volume string as adopted —
   * `cephtb4:vm-101-disk-0,size=32G` (n is 0 to 30, pve-qemu-server's own `$MAX_SCSI_DISKS`).
   */
  [scsi: `scsi${number}`]: string | undefined;
  /**
   * `virtio=<mac>,bridge=vmbr0,tag=<vlan>` — a VLAN-aware bridge with an 802.1q tag is a bridge
   * plus this one sub-property; PVE's SDN stays out of it entirely (n is 0 to 31).
   */
  [nic: `net${number}`]: string | undefined;
  /**
   * The cloud-init drive, e.g. `cephtb4:cloudinit`. PVE's own web UI puts it on `ide2`, but any
   * free `ide`/`sata`/`scsi` slot works; declaring one is what gives `ipconfig0` below somewhere
   * to write the generated seed image (n is 0 to 3).
   */
  [cloudinit: `ide${number}`]: string | undefined;
  /** cloud-init network config: `ip=dhcp`, or `ip=<cidr>,gw=<gw>` (n is 0 to 31). */
  [ipconfig: `ipconfig${number}`]: string | undefined;
  /** `socket` — a serial console, the way Talos exposes its own (n is 0 to 3). */
  [serial: `serial${number}`]: string | undefined;
  /** ⛔ A secret. See the header. */
  cipassword?: never;
  /** ⛔ Machine config. See the header. */
  machine?: never;
}

export interface VmAttributes {
  node: string;
  vmid: number;
  /** The live config, MANAGED keys only — see `storedConfig`. An allowlist, not a mirror. */
  config: Record<string, string>;
}

/** Props that identify the object rather than configure it: never sent, never compared. */
const NOT_CONFIG: ReadonlySet<string> = new Set(['node', 'target', 'vmid']);

/** The indexed families this resource manages, with pve-qemu-server's own published range. */
export const INDEXED = {
  ide: 4,
  ipconfig: 32,
  net: 32,
  scsi: 31,
  serial: 4,
} as const;
export type IndexedFamily = keyof typeof INDEXED;

/** `scsi3` → `['scsi', 3]`; anything else, including an out-of-range index, → undefined. */
export const indexedKey = (key: string): readonly [IndexedFamily, number] | undefined => {
  const match = /^(ide|ipconfig|net|scsi|serial)(0|[1-9]\d*)$/.exec(key);
  if (match === null) return undefined;
  const family = match[1] as IndexedFamily;
  const index = Number(match[2]);
  return index < INDEXED[family] ? [family, index] : undefined;
};

/** The scalar (non-indexed) keys this resource manages. */
const SCALAR_KEYS: ReadonlySet<string> = new Set([
  'agent',
  'boot',
  'cores',
  'cpu',
  'memory',
  'name',
  'onboot',
  'scsihw',
  'sockets',
]);

/**
 * A key this resource compares and may write. ⛔ EVERYTHING ELSE IS REFUSED, NEVER SILENTLY
 *   DROPPED OR SILENTLY SENT — `qemu-form.ts`'s `formRefusals` is what a declared key smuggled
 *   past the types (a cast, a JS caller: `cipassword`, `machine`, `hookscript`) meets before any
 *   write, the same rule `lxc-create-form.ts` enforces for `Proxmox.Lxc`.
 */
export const isManagedKey = (key: string): boolean =>
  SCALAR_KEYS.has(key) || indexedKey(key) !== undefined;

/** A declaration read by key. ⚠️ The cast is the one place a template-literal index meets a plain string. */
export const declaredValue = (props: VmProps, key: string): unknown =>
  (props as unknown as Record<string, unknown>)[key];

/** The declared keys with a value, in a stable order — never `node`/`target`/`vmid`. */
export const declaredKeys = (props: VmProps): string[] =>
  Object.keys(props)
    .filter((key) => !NOT_CONFIG.has(key) && declaredValue(props, key) !== undefined)
    .sort();

/** One declared value as PVE's wire string. Booleans go as `1`/`0`, numbers as their decimal. */
export const wireValue = (value: unknown): string =>
  value === true ? '1' : value === false ? '0' : String(value);

/**
 * The live config as strings: managed keys only.
 * ⛔ AN ALLOWLIST, NOT "EVERYTHING BUT A DENYLIST" — same reasoning as `lxc-props.ts`'s
 *   `storedConfig`. `digest` covers the whole file, `lock`/`pending` are transient, and a future
 *   PVE release's new key does not land in this estate's unencrypted state store until this
 *   resource is taught to manage it.
 */
export const storedConfig = (live: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(live)) {
    if (!isManagedKey(key)) continue;
    if (value === null || value === undefined || typeof value === 'object') continue;
    out[key] = wireValue(value);
  }
  return out;
};
