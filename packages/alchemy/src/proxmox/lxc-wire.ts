/**
 * How a container's config values are spelled on the wire, and when two spellings are one value.
 *
 * ★ EVERY RULE HERE IS READ OFF pve-container 6.1.14 (the PVE 9 line, `src/PVE/LXC/Config.pm` at
 *   git.proxmox.com HEAD, 2026-09-21) or off a live guest's config read with
 *   `pvesh get /nodes/<node>/lxc/<vmid>/config`. A rule nobody measured is a forever-diff waiting to
 *   happen: the plan reports an update, the deploy writes the same value back, and the next plan
 *   reports it again.
 *
 * ⚠️ PVE PRINTS A PROPERTY STRING IN ITS OWN KEY ORDER AND WITH ITS OWN DEFAULTS FILLED IN.
 *   MEASURED on a live guest: `net0` comes back `name=eth0,bridge=…,firewall=0,gw=…,hwaddr=…,ip=…,
 *   mtu=1500,tag=…,type=veth` — `name` first, then alphabetical, with `type=veth` and a generated
 *   `hwaddr` nobody declared — and `mp0` carries `backup=0` although `0` is what absent means.
 *   So values are compared as maps with the defaults dropped, never as strings.
 */
import { canonicalToken, propertyString } from './values.ts';

/** `a=1,b=2` → `[['a','1'],['b','2']]`. A bare token is `defaultKey`'s value. */
export const pairs = (value: string, defaultKey?: string): [string, string][] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part): [string, string] => {
      const at = part.indexOf('=');
      if (at === -1) return [defaultKey ?? part, defaultKey === undefined ? '' : part];
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    });

/**
 * A key's default, per family: the value PVE treats absence as.
 * ⚠️ `replicate` DEFAULTS ON and everything else here defaults off. `backup` on a mount point is
 *   off when absent: vzdump skips any `mpN` without `backup=1` (the rootfs is always included).
 */
const DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  dev: { 'deny-write': '0' },
  features: { force_rw_sys: '0', fuse: '0', keyctl: '0', mknod: '0', nesting: '0' },
  net: { firewall: '0', 'host-managed': '0', link_down: '0', type: 'veth' },
  volume: { backup: '0', keepattrs: '0', quota: '0', replicate: '1', ro: '0', shared: '0' },
};

/** Boolean keys, whose `1`/`true`/`on` spellings are one value. */
const FLAGS = new Set([
  'acl',
  'backup',
  'deny-write',
  'firewall',
  'force_rw_sys',
  'fuse',
  'host-managed',
  'keepattrs',
  'keyctl',
  'link_down',
  'mknod',
  'nesting',
  'quota',
  'replicate',
  'ro',
  'shared',
]);

/** Keys holding a `;` list PVE does not promise to keep in order. */
const SETS = new Set(['mount', 'mountoptions']);

/** One option value in its comparable spelling. ⚠️ A MAC is upper-cased: PVE stores it that way. */
const canonicalValue = (key: string, value: string) => {
  if (FLAGS.has(key)) return canonicalToken(value);
  if (SETS.has(key))
    return [...new Set(value.split(';').map((part) => part.trim()))].sort().join(';');
  if (key === 'hwaddr') return value.toUpperCase();
  return value;
};

/** A property string as a map of comparable values, with `family`'s defaults dropped. */
export const optionMap = (
  value: string,
  family: keyof typeof DEFAULTS,
  defaultKey?: string,
): Map<string, string> => {
  const defaults = DEFAULTS[family] ?? {};
  const out = new Map<string, string>();
  for (const [key, raw] of pairs(value, defaultKey)) {
    const canonical = canonicalValue(key, raw);
    if (defaults[key] !== canonical) out.set(key, canonical);
  }
  return out;
};

export const sameMap = (left: Map<string, string>, right: Map<string, string>) =>
  left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);

/** A map as one order-free string, for comparing and for naming a value in a message. */
export const sortedForm = (map: Map<string, string>) =>
  [...map]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(',');

/** A map back to a property string, `lead` keys first — PVE wants `name` and the volume first. */
export const printMap = (map: Map<string, string>, lead: readonly string[] = []) =>
  [...lead.filter((key) => map.has(key)), ...[...map.keys()].filter((k) => !lead.includes(k))]
    .map((key) => `${key}=${map.get(key) ?? ''}`)
    .join(',');

/**
 * `net` maps for comparison. ⚠️ AN UNDECLARED `hwaddr` IS PVE'S, NOT DRIFT: PVE generates one on
 * create, so the live MAC is dropped before comparing when the declaration names none.
 */
export const netMaps = (declared: string, live: string) => {
  const want = optionMap(declared, 'net');
  const have = optionMap(live, 'net');
  if (!want.has('hwaddr')) have.delete('hwaddr');
  return { have, want };
};

/**
 * The `net` value to PUT: the declaration, plus the live MAC when it names none.
 * ⛔ WITHOUT THE LIVE MAC, A PUT OF AN UNCHANGED NIC WOULD GENERATE A NEW ONE — a new MAC is a new
 *   DHCP lease and a new IPv6 link-local address for a guest that only had its MTU edited.
 */
export const netWrite = (declared: string, live: string | undefined) => {
  const want = new Map(pairs(declared));
  const mac = live === undefined ? undefined : new Map(pairs(live)).get('hwaddr');
  if (!want.has('hwaddr') && mac !== undefined) want.set('hwaddr', mac);
  return printMap(want, ['name']);
};

/** Tags as PVE stores them: split on `;`, `,` or space, deduplicated, sorted, lower-cased. */
export const tagSet = (value: string) =>
  [...new Set(value.split(/[;,\s]+/).filter((tag) => tag !== ''))]
    .map((tag) => tag.toLowerCase())
    .sort()
    .join(';');

/** A resolver list: order matters, the separator does not. */
export const orderedList = (value: string) =>
  value
    .split(/[;,\s]+/)
    .filter((part) => part !== '')
    .join(' ');

/**
 * ⚠️ PVE STORES A DESCRIPTION AS `#` COMMENT LINES AND READS EACH BACK WITH `"\n"` APPENDED
 *   (`parse_pct_config`), so `foo` comes back `foo\n`. Trailing whitespace is not the value.
 */
export const descriptionText = (value: string) => value.replace(/\s+$/, '');

/** How each scalar config key is compared. A key missing here is not one this resource manages. */
export const SCALAR_KINDS: Readonly<Record<string, 'text' | 'number' | 'flag' | 'form'>> = {
  arch: 'text',
  cmode: 'text',
  console: 'flag',
  cores: 'number',
  cpulimit: 'number',
  cpuunits: 'number',
  description: 'form',
  features: 'form',
  hostname: 'text',
  memory: 'number',
  nameserver: 'form',
  onboot: 'flag',
  ostype: 'text',
  protection: 'flag',
  searchdomain: 'form',
  startup: 'form',
  swap: 'number',
  tags: 'form',
  timezone: 'text',
  tty: 'number',
};

/** Keys a declaration may set to `''` to mean "remove it". `delete=` takes them; nothing else may. */
export const CLEARABLE: ReadonlySet<string> = new Set([
  'description',
  'features',
  'nameserver',
  'searchdomain',
  'startup',
  'tags',
  'timezone',
]);

/**
 * What an absent key means, from the confdesc defaults. ⚠️ Only these compare equal to absence;
 * `cores` absent means "every host core", which no number declares.
 */
export const SCALAR_DEFAULTS: Readonly<Record<string, string>> = {
  arch: 'amd64',
  cmode: 'tty',
  console: '1',
  cpulimit: '0',
  memory: '512',
  onboot: '0',
  protection: '0',
  swap: '512',
  tty: '2',
};

/** One scalar value in its comparable spelling. */
export const scalarForm = (key: string, value: string): string => {
  const kind = SCALAR_KINDS[key];
  if (kind === 'number') return String(Number(value));
  if (kind === 'flag') return canonicalToken(value);
  if (key === 'description') return descriptionText(value);
  if (key === 'features') return sortedForm(optionMap(value, 'features'));
  if (key === 'nameserver' || key === 'searchdomain') return orderedList(value);
  if (key === 'startup') return propertyString(value, 'order');
  if (key === 'tags') return tagSet(value);
  return value;
};
