/**
 * `Proxmox.NodeNetwork`'s WRITE side, PLUS the wire coercions node-network-wire.ts's own read
 * side needs too — kept here rather than duplicated, since neither `matches` (comparison) nor
 * `updateForm` (clearing) makes sense without agreeing on the same normalisation. Split out of
 * node-network.ts (2026-09-24, the distilled migration) — the storage.ts/storage-form.ts seam.
 */
import type * as nodes from '@distilled.cloud/proxmox/nodes';
import type { NodeNetworkProps } from './node-network.ts';
import { flag, text, withClears } from './values.ts';

export const NODE_NETWORK_CREATE = 'pve:POST /nodes/{node}/network';
export const NODE_NETWORK_UPDATE = 'pve:PUT /nodes/{node}/network/{iface}';

/**
 * "Not set", for the three integers this family reports.
 *
 * ⚠️ 0 CANNOT BE THE ABSENT-MARKER AND -1 CAN. `mtu` is 1280-65520, `vlan-id` 1-4094 and PVE's
 *   `priority` starts at 1 (1 is reserved for `lo`), so -1 is outside every one of their ranges
 *   while 0 is merely outside today's. metric-server-form.ts keeps its own constant for the same
 *   reason and against different ranges; one shared UNSET would have to be right for both.
 */
export const UNSET = -1;

/**
 * A space-separated interface list, flattened to one comparable form.
 *
 * ⚠️ `bridge_ports` AND `slaves` ARE SETS, AND PVE NORMALISES THEIR SEPARATORS BUT NOT THEIR ORDER.
 *   MEASURED in PVE::Network::Interfaces: the writer does `s/[;,\s]+/ /g` on both before emitting
 *   them, and the reader hands the resulting string straight back — so `enp2s0f1np1 enp2s0f0np0`
 *   survives a round trip in the order it was written. Order carries no meaning for a bridge's
 *   ports or a bond's slaves, so a declaration that lists them the other way round is the SAME
 *   declaration; comparing raw strings would report an update that rewrites the file to say
 *   exactly what it already said. Both sides are sorted here and only then compared.
 *
 * ⚠️ IT IS NOT `csv` FROM values.ts. That one joins with commas, and a comma in
 *   `/etc/network/interfaces` is not a separator — PVE's own comment above the writer says the
 *   list "must be space separated! other separators will cause problems". Sending a comma-joined
 *   value would be accepted by `split_list` and then written back as spaces, which is a second
 *   spelling of one value and therefore a second chance to diff.
 *
 * ⚠️ `bridge_vids` GOES THROUGH THE SAME FUNNEL and its sort is LEXICAL, which is correct only
 *   because a vid list is a set: `2-4094` is one token, and `100-200 2` and `2 100-200` allow the
 *   same VLANs. Nothing here should be reused for a list whose order is meaning.
 */
export const ifaceList = (value: unknown) =>
  text(value)
    .split(/[\s,;]+/)
    .filter((part) => part !== '')
    .sort()
    .join(' ');

/**
 * A comment off the wire, with the newline PVE adds taken back off.
 *
 * ⛔ `comments` NEVER ROUND-TRIPS RAW, AND THAT IS A FOREVER-DIFF IF IT IS NOT NORMALISED.
 *   MEASURED in the reader: each `#...` line is appended as `$comment . "\n"`, so a declared
 *   `ceph transport` comes back as `ceph transport\n` and the two never compare equal.
 * ⚠️ AND THE READER FOLDS `comments6` INTO `comments` (`$d->{comments} .= $comments6`), so on an
 *   interface that carries an IPv6 comment a declared `comments` CANNOT match what comes back.
 *   C1 has none; on an interface that does, leave `comments` undeclared rather than fighting it.
 */
export const comment = (value: unknown) => text(value).replace(/\s+$/, '');

/** Undeclared is unmanaged: neither sent nor compared. */
export const same = <T>(declared: T | undefined, live: T) =>
  declared === undefined || declared === live;

export const sameList = (declared: string | undefined, live: string) =>
  declared === undefined || ifaceList(declared) === live;

export const sameComment = (declared: string | undefined, live: string) =>
  declared === undefined || comment(declared) === live;

const field = (name: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [name]: value };

/**
 * The fields sent on EVERY write, create and update alike.
 *
 * ⚠️ UNDECLARED IS UNMANAGED — not sent, and not compared either. PVE's PUT MERGES the form into
 *   the existing stanza (`foreach my $k (keys %$param) { $ifaces->{$iface}->{$k} = $param->{$k} }`),
 *   so an omitted parameter is left exactly as it was. `cidr` is the one exception and it is not
 *   a small one — see node-network.ts's own ⛔.
 *
 * ⛔ `type` IS REQUIRED ON THE PUT, NOT ONLY ON THE POST. It carries no `optional` in either
 *   schema (CONFIRMED again in distilled's generated `PutNodeNetwork2Request`/
 *   `CreateNodeNetworkRequest`), and the merge above writes it straight into the stanza — so a PUT
 *   naming the wrong type would RETYPE A LIVE INTERFACE in the file. node-network-wire.ts's
 *   `attributesOf` refuses that case before it can reach here.
 *
 * ⛔ `bridge_vlan_aware` IS SENT ONLY WHEN TRUE, AND A FALSE ONE IS A `delete=`. MEASURED in the
 *   writer: the test is `if (defined($d->{bridge_vlan_aware}))`, not a truth test, so `0` is
 *   defined and PVE writes `bridge-vlan-aware yes` anyway. Sending `0` would therefore turn the
 *   flag ON, read back as `1`, and diff forever while lying about which way it went.
 *
 * ⚠️ `netmask` IS A WRITABLE PARAMETER AND IS DELIBERATELY NOT OFFERED. PVE raises
 *   "netmask conflicts with cidr" when both are sent, and the reader rewrites whatever was written
 *   into prefix form — MEASURED: node-b's vmbr1.42 reports `"netmask":"24"`, never `255.255.255.0`.
 *   A resource accepting both spellings would let a declaration diff against its own value.
 *
 * ★ HYPHENATED, THE WIRE SHAPE — `guardWrite` (node-network.ts) checks this form directly, keyed
 *   by PVE's own names (`generated/constraints/pve-nodes-network.ts`). `toDistilledCreate`/
 *   `toDistilledUpdate` below translate a COPY for the actual SDK call — storage-form.ts's
 *   `underscored` has the fuller measurement of why the wire itself does not need this rename
 *   (distilled's own `T.Body()` annotation re-hyphenates on the way out either way), reused here
 *   only for the three fields this family's schema renames: `bond-primary`, `vlan-id`,
 *   `vlan-raw-device` -> `bond_primary`, `vlan_id`, `vlan_raw_device`.
 */
export const body = (props: NodeNetworkProps): Record<string, string> => ({
  ...field('autostart', flag(props.autostart)),
  ...field('bond-primary', props['bond-primary']),
  ...field('bond_mode', props.bond_mode),
  ...field('bond_xmit_hash_policy', props.bond_xmit_hash_policy),
  ...field('bridge_ports', props.bridge_ports),
  ...field('bridge_vids', props.bridge_vids),
  ...field('bridge_vlan_aware', props.bridge_vlan_aware === true ? '1' : undefined),
  ...field('cidr', props.cidr),
  ...field('comments', props.comments),
  ...field('gateway', props.gateway),
  ...field('mtu', props.mtu === undefined ? undefined : String(props.mtu)),
  ...field('slaves', props.slaves),
  ...field('vlan-id', props['vlan-id'] === undefined ? undefined : String(props['vlan-id'])),
  ...field('vlan-raw-device', props['vlan-raw-device']),
  type: props.type,
});

/**
 * The create form: `body` plus the name of the interface being created.
 *
 * 🔴 `iface` MUST BE IN THE BODY, NOT ONLY THE PATH — `POST /nodes/{node}/network` declares
 *   `iface` REQUIRED (`pve-iface`, 2..20) and `{node}` is its only path parameter, CONFIRMED again
 *   in distilled's generated `CreateNodeNetworkRequest`, which carries `iface` as a plain body
 *   field, never a `T.Label()`. The pre-distilled client.ts version of this file shipped without
 *   it for a time (see the git history around 2026-09-22) — every create this family had ever
 *   planned would have 400ed, caught only because every C1 interface had been adopted, never
 *   created, so nothing exercised the POST until the vendor table was wired in.
 *
 * ⚠️ NOT ADDED TO `body`, BECAUSE THE PUT MUST NOT CARRY IT. `additionalProperties => 0` on the
 *   update schema makes a second copy of the name a 400 rather than an ignored hint.
 */
export const createForm = (props: NodeNetworkProps): Record<string, string> => ({
  ...body(props),
  iface: props.iface,
});

/**
 * The update form: `body` plus the two fields that can only be cleared explicitly.
 *
 * ⛔ `delete=cidr` IS SENT WHENEVER `cidr` IS UNDECLARED, AND IT IS THE LESSER OF TWO EVILS RATHER
 *   THAN A GOOD OUTCOME. PVE recomputes the method on every write from the form alone —
 *   `$param->{method} = $param->{address} ? 'static' : 'manual'` — so a PUT WITHOUT an address
 *   makes the interface manual no matter what the caller intended. Left at that, the merge would
 *   leave the old `address` and `netmask` in the hash and the writer would emit an `address` line
 *   under `iface … inet manual`: a stanza PVE's own UI cannot produce. Clearing cidr explicitly at
 *   least produces a clean, honest manual interface — and `matches` compares `cidr`
 *   UNCONDITIONALLY, so the plan says so first.
 *
 * ⛔ ON vmbr1.42 THAT IS THE CEPH TRANSPORT. A declaration of that interface without its `cidr` is
 *   a declaration that it should have no address, applied across three nodes. The plan will read
 *   `1 to update` rather than `noop`; do not wave it through.
 *
 * ⚠️ `delete` IS A PUT-ONLY PARAMETER. The POST schema has no `delete` at all, which is why
 *   `createForm` calls `body` directly rather than going through this function.
 */
export const updateForm = (props: NodeNetworkProps): Record<string, string> => {
  const clear = [
    ...(props.cidr === undefined ? ['cidr'] : []),
    ...(props.bridge_vlan_aware === false ? ['bridge_vlan_aware'] : []),
  ];
  return withClears(body(props), clear);
};

/**
 * The three fields distilled's generator renamed to an underscore (`bond-primary`, `vlan-id`,
 * `vlan-raw-device`) — everything else round-trips as-is. `storage-form.ts`'s `underscored` is a
 * generic transform for a free-form bag; this family's fields are all named ahead of time, so a
 * small local map is clearer than importing a generic helper for three keys.
 */
const RENAMED: Readonly<Record<string, string>> = {
  'bond-primary': 'bond_primary',
  'vlan-id': 'vlan_id',
  'vlan-raw-device': 'vlan_raw_device',
};

const toDistilled = (form: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(form).map(([key, value]) => [RENAMED[key] ?? key, value]));

/** The actual `createNodeNetwork` call body — `createForm`, translated once. See `toDistilled`. */
export const toDistilledCreate = (props: NodeNetworkProps): nodes.CreateNodeNetworkRequest =>
  ({
    ...toDistilled(createForm(props)),
    node: props.node,
  }) as unknown as nodes.CreateNodeNetworkRequest;

/** The actual `putNodeNetwork2` call body — `updateForm`, translated once. See `toDistilledCreate`. */
export const toDistilledUpdate = (props: NodeNetworkProps): nodes.PutNodeNetwork2Request =>
  ({
    ...toDistilled(updateForm(props)),
    iface: props.iface,
    node: props.node,
  }) as unknown as nodes.PutNodeNetwork2Request;
