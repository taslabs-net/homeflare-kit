/**
 * What a `Proxmox.Lxc` declaration says, and what its state keeps.
 *
 * ★ THE PROPS ARE PVE'S OWN KEYS, SPELLED THE WAY `pvesh get /nodes/{node}/lxc/{vmid}/config`
 *   PRINTS THEM — `mp0`, `net1`, `dev0`, `rootfs` as property strings, `onboot` as `1`. Adopting a
 *   live container is then a paste of its config, not a translation of it, and a translation is
 *   where an adoption goes wrong: one mistyped key and the first deploy writes it. The generated
 *   `NodesNodeLxcVmidConfigGetReturn` (pve-manager 9.2.11 schema) names the same keys.
 *
 * ⛔ AN UNDECLARED KEY IS UNMANAGED: never sent, never compared, never deleted. A guest carries
 *   keys PVE fills in on its own (`arch`, `ostype`, `digest`, a NIC's `hwaddr`) and keys somebody
 *   set by hand; guessing a default for either would turn an omission into a write on a running
 *   guest. To REMOVE a key, declare it empty (`''`) where lxc-judge.ts allows that.
 *
 * ⛔ NO SECRET IS A PROP, AND THE THREE THAT PVE ACCEPTS ARE TYPED `never`. `password` and
 *   `ssh-public-keys` are create parameters; `env` (PVE 9 application containers) holds runtime
 *   environment that can carry anything. Alchemy stores props unencrypted and this estate's state
 *   store is dumped nightly, so declaring one is a compile error rather than a leak found in a
 *   backup. A container created here has no root password: reach it with `pct enter` on its node.
 */
import { SCALAR_KINDS } from './lxc-wire.ts';
import type { WithTarget } from './resource.ts';

/** A PVE boolean as pvesh prints it (`1`) or as TypeScript writes it (`true`). The same value. */
export type PveFlag = boolean | 0 | 1;

export interface LxcProps extends WithTarget {
  /**
   * The node that hosts it. ⛔ This resource never migrates: naming another node plans only when
   * the guest is already there (after HA or `pct migrate`), and then writes nothing.
   */
  node: string;
  /** ⛔ CLUSTER-WIDE primary key, shared with QEMU VMs. Required, never allocated here. */
  vmid: number;
  /**
   * `local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst`. ⚠️ CREATE-ONLY AND NOT READABLE BACK:
   * PVE consumes it while unpacking the rootfs. Optional, because an adopted guest was built from a
   * template nobody recorded; required only when this resource has to create the guest.
   */
  ostemplate?: string;
  /** Start the guest once, after its create finishes (PVE's create `start`). ⚠️ Never compared. */
  start?: PveFlag;
  /**
   * ⛔ READ-ONLY AFTER CREATE. PVE refuses to change it ("unable to modify read-only option"), so a
   * differing value is refused at plan. Absent from a live config means `0`: privileged. On create,
   * PVE's own default is `1`.
   */
  unprivileged?: PveFlag;
  hostname?: string;
  arch?: string;
  ostype?: string;
  cores?: number;
  /** `0` means no limit. May be fractional (`1.5`). */
  cpulimit?: number;
  cpuunits?: number;
  /** MiB. */
  memory?: number;
  /** MiB. */
  swap?: number;
  /**
   * `local-zfs:subvol-100-disk-0,size=40G` as read, or `local-zfs:40` (40 GiB, new volume) to
   * create. See lxc-volume.ts for what may change: options in place, size up only.
   */
  rootfs?: string;
  /** `nesting=1,keyctl=1`. ⛔ Only `nesting` is writable by an API token — see lxc-judge.ts. */
  features?: string;
  onboot?: PveFlag;
  /** `order=1,up=30,down=60`. */
  startup?: string;
  protection?: PveFlag;
  /** Free text. ⚠️ PVE stores it as `#` comment lines and hands it back with a trailing newline. */
  description?: string;
  /** `a;b`. ⚠️ Compared as a set; PVE sorts and, by default, lowercases them. */
  tags?: string;
  /** Space-separated. Order is meaningful to a resolver, so it is compared in order. */
  nameserver?: string;
  searchdomain?: string;
  timezone?: string;
  console?: PveFlag;
  tty?: number;
  cmode?: string;
  /** `tank:subvol-100-disk-1,mp=/data,backup=1,size=100G`, or `tank:100,mp=/data` to create. */
  [mount: `mp${number}`]: string | undefined;
  /** `name=eth0,bridge=vmbr0,ip=dhcp`. ⚠️ An undeclared `hwaddr` keeps the live MAC. */
  [nic: `net${number}`]: string | undefined;
  /** `/dev/net/tun`, `/dev/dri/renderD128,gid=44,mode=0660`. ⛔ root@pam only — see lxc-judge.ts. */
  [device: `dev${number}`]: string | undefined;
  /** ⛔ A secret. See the header. */
  password?: never;
  /** ⛔ Treated as a secret here. See the header. */
  'ssh-public-keys'?: never;
  /** ⛔ Can carry anything, and a read token cannot even see it. See the header. */
  env?: never;
}

export interface LxcAttributes {
  node: string;
  vmid: number;
  /**
   * The live config, each value as PVE's own string: every key this resource MANAGES
   * (`isManagedKey`), declared or not, minus the keys in `UNSTORED`.
   * ★ A MAP RATHER THAN TYPED FIELDS so a plan can show whatever managed key the guest carries.
   * ⛔ AN ALLOWLIST, NOT "EVERYTHING BUT A DENYLIST" — see `storedConfig`.
   */
  config: Record<string, string>;
  /**
   * The raw `lxc.*` lines in the guest's config file — NAMES ONLY.
   * ⚠️ A GAP, NOT A FEATURE: PVE's API returns these but cannot set them (`lxc.prlimit.memlock`,
   *   `lxc.cgroup2.devices.allow`, `lxc.mount.entry`). They are edited in `/etc/pve/lxc/<vmid>.conf`
   *   on the node, so this resource reports that they exist and never compares them. ⛔ Values are
   *   not stored: `lxc.environment` is one of the keys PVE allows there.
   */
  rawKeys: string[];
}

/**
 * Keys a read returns that state never keeps.
 * ⚠️ `digest` covers the whole file and `lock` is transient (a running backup), so either would
 *   rewrite state on every read; `env` and `lxc` are the secret risks in the header and above.
 * ⛔ `description` IS THE GUEST'S "NOTES" PANEL IN THE PVE UI, where people paste credentials. A
 *   declared one is already in props; an undeclared one is not this resource's to copy into an
 *   unencrypted state store.
 */
export const UNSTORED: ReadonlySet<string> = new Set([
  'description',
  'digest',
  'env',
  'lock',
  'lxc',
  'pending',
]);

/** The indexed families, with PVE's own limits (pve-container `$MAX_*`, 6.1.14). */
export const INDEXED = {
  dev: 256,
  mp: 256,
  net: 32,
} as const;

export type IndexedFamily = keyof typeof INDEXED;

/** `mp3` → `['mp', 3]`; anything else → undefined. ⚠️ `mp03` is not a PVE key. */
export const indexedKey = (key: string): readonly [IndexedFamily, number] | undefined => {
  const match = /^(mp|net|dev)(0|[1-9]\d*)$/.exec(key);
  if (match === null) return undefined;
  const family = match[1] as IndexedFamily;
  const index = Number(match[2]);
  return index < INDEXED[family] ? [family, index] : undefined;
};

/** Props that are not config keys: where the guest lives, and create-time instructions. */
export const NOT_CONFIG: ReadonlySet<string> = new Set([
  'node',
  'ostemplate',
  'start',
  'target',
  'vmid',
]);

/**
 * A declaration read by key. ⚠️ The cast is the one place the three template-literal index
 * signatures meet a plain string key; every reader goes through here rather than casting again.
 */
export const declaredValue = (props: LxcProps, key: string): unknown =>
  (props as unknown as Record<string, unknown>)[key];

/** The declared config keys with a value, in a stable order. `''` counts: it means "absent". */
export const declaredKeys = (props: LxcProps): string[] =>
  Object.keys(props)
    .filter((key) => !NOT_CONFIG.has(key) && declaredValue(props, key) !== undefined)
    .sort();

/** One declared value as PVE's wire string. Booleans go as `1`/`0`, numbers as their decimal. */
export const wireValue = (value: unknown): string =>
  value === true ? '1' : value === false ? '0' : String(value);

/**
 * A key this resource compares and may write: a scalar lxc-wire.ts knows, `unprivileged`, `rootfs`,
 * or an indexed `mpN`/`netN`/`devN`. ★ ONE PREDICATE FOR THE THREE PLACES THAT ASK: `judge` refuses
 * any other declared key, `createRefusals` refuses it before a POST, and `storedConfig` keeps
 * nothing else. ⛔ Without the create half, a key smuggled past the types (a cast, a JS caller:
 * `password`, `force`, `restore`, `hookscript`) went into the create body verbatim.
 */
export const isManagedKey = (key: string): boolean =>
  SCALAR_KINDS[key] !== undefined ||
  key === 'unprivileged' ||
  key === 'rootfs' ||
  indexedKey(key) !== undefined;

/**
 * The live config as strings: managed keys only, the unstored ones dropped.
 * ⛔ AN ALLOWLIST, BECAUSE A DENYLIST IS SURPRISED BY THE NEXT PVE RELEASE. `env` joined the config
 *   in PVE 9 with application containers, and `entrypoint` with it — a command line, which can
 *   carry a token as an argument. Under "store everything except UNSTORED" each new key lands in
 *   the unencrypted state store until somebody notices; under this, it is not stored until this
 *   resource manages it. `hookscript`, `unusedN`, `parent` and `lock` are dropped the same way.
 */
export const storedConfig = (live: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(live)) {
    if (!isManagedKey(key) || UNSTORED.has(key)) continue;
    if (value === null || value === undefined || typeof value === 'object') continue;
    out[key] = wireValue(value);
  }
  return out;
};

/** `[["lxc.prlimit.memlock","unlimited"]]` → `['lxc.prlimit.memlock']`. Values are dropped. */
export const rawKeysOf = (live: Record<string, unknown>): string[] => {
  const raw = live['lxc'];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((pair: unknown) => (Array.isArray(pair) ? String(pair[0]) : ''))
    .filter((key) => key !== '');
};
