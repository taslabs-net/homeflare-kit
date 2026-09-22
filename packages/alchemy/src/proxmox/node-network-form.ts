/**
 * How a node interface crosses the wire in both directions — props to a PVE form, a PVE answer to
 * a comparable attribute — and when two of those values count as the same value.
 *
 * ★ SPLIT OUT OF node-network.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is the
 *   same one metric-server-form.ts uses, one field wider: this file owns the COERCIONS, in both
 *   directions, because a read that normalises differently from the write that produced it is
 *   exactly how a forever-diff is born — keeping `ifaceList` next to both ends is what stops that.
 *   node-network.ts answers "what is an interface, and which of its fields are safe to compare at
 *   all". Nothing here calls the cluster.
 *
 * ⚠️ THE `import type` BACK TO node-network.ts IS A CYCLE ON PAPER ONLY — type-only, erased before
 *   anything runs, so `NodeNetworkProps` stays in the file that declares the resource.
 *
 * * ⛔ THE LAST SEVEN ARE REPORTED AND NEVER COMPARED, AND EACH ONE IS A MEASURED FOREVER-DIFF.
 *   `priority` is assigned by PVE FROM FILE ORDER — `my $priority = 2; ... $d->{priority} =
 *   $priority++` — and it is not a POST or PUT parameter at all. MEASURED ACROSS C1: vmbr1.42 is
 *   priority 16 on node-b and node-c and 15 on node-d, because node-d has no `wlan0` above it. One declaration
 *   reused across three nodes would diff on exactly one of them, forever, over nothing.
 *   `method` is RECOMPUTED on every write from whether the form carried an address, `families` is
 *   recomputed the same way and never written to the file, `active` and `exists` describe the
 *   kernel rather than the config, and `bond_miimon`, `bridge_stp` and `bridge_fd` are emitted by
 *   PVE's writer with defaults (100, `off`, 0) while appearing in NEITHER write schema —
 *   `additionalProperties => 0` means sending one is a 400. Live proof of all three: node-b's bond0
 *   returns `bond_miimon "100"` and vmbr1 returns `bridge_stp "off"`, `bridge_fd "0"`, none of
 *   which any declaration can set.
 */
import type { NodeNetworkAttributes, NodeNetworkProps } from './node-network.ts';
import { bool, flag, int, text, withClears } from './values.ts';

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

/** Undeclared is unmanaged: neither sent nor compared. See the ⚠️ on `body`. */
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
 *   a small one — see the ⛔ in node-network.ts.
 *
 * ⛔ `type` IS REQUIRED ON THE PUT, NOT ONLY ON THE POST. It carries no `optional` in either
 *   schema, and the merge above writes it straight into the stanza — so a PUT naming the wrong
 *   type would RETYPE A LIVE INTERFACE in the file and the writer would then emit a bridge stanza
 *   for what is really a vlan. node-network.ts refuses that case before it can reach here.
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
 * The update form: `body` plus the two fields that can only be cleared explicitly.
 *
 * ⛔ `delete=cidr` IS SENT WHENEVER `cidr` IS UNDECLARED, AND IT IS THE LESSER OF TWO EVILS RATHER
 *   THAN A GOOD OUTCOME. PVE recomputes the method on every write from the form alone —
 *   `$param->{method} = $param->{address} ? 'static' : 'manual'` — so a PUT WITHOUT an address
 *   makes the interface manual no matter what the caller intended. Left at that, the merge would
 *   leave the old `address` and `netmask` in the hash and the writer would emit an `address` line
 *   under `iface … inet manual`: a stanza PVE's own UI cannot produce, whose behaviour under
 *   `ifreload -a` I did NOT measure. Clearing cidr explicitly at least produces a clean, honest
 *   manual interface — and `matches` compares `cidr` UNCONDITIONALLY, so the plan says so first.
 *
 * ⛔ ON vmbr1.42 THAT IS THE CEPH TRANSPORT. A declaration of that interface without its `cidr` is
 *   a declaration that it should have no address, applied across three nodes. The plan will read
 *   `1 to update` rather than `noop`; do not wave it through.
 *
 * ⚠️ `delete` IS A PUT-ONLY PARAMETER. The POST schema is `additionalProperties => 0` and has no
 *   `delete`, so sending it on a create is a 400 — which is why `createForm` calls `body` directly.
 */
export const updateBody = (props: NodeNetworkProps): Record<string, string> => {
  const clear = [
    ...(props.cidr === undefined ? ['cidr'] : []),
    ...(props.bridge_vlan_aware === false ? ['bridge_vlan_aware'] : []),
  ];
  const fields = body(props);
  return withClears(fields, clear);
};

/**
 * One live interface as attributes, or `undefined` — "this is not really there".
 *
 * ⚠️ EVERY FIELD PVE REPORTS IS CARRIED HERE, INCLUDING THE SEVEN NO DECLARATION CAN SET. A plan
 *   that cannot show `priority`, `method` or `bond_miimon` cannot explain why it is ignoring them,
 *   and the next person to read a forever-diff would start by adding them to `matches`. They are
 *   reported precisely so that they are visibly OUT of it — see the ⛔ above the attribute type.
 */
export const readAttributes = (
  live: Record<string, unknown>,
  props: NodeNetworkProps,
): NodeNetworkAttributes | undefined => {
  /**
   * ⛔ AN INTERFACE OF ANOTHER TYPE IS ANOTHER OBJECT, AND "ABSENT" IS THE SAFE ANSWER — the
   *   same call metric-server.ts makes, for a worse reason. `type` is required on the PUT and
   *   the PUT MERGES, so a declaration naming `bridge` for what is really a vlan would write
   *   `type bridge` into the stanza and PVE's writer would then emit bridge-ports and
   *   bridge-stp lines for vmbr1.42. Reporting absent instead makes reconcile POST a create,
   *   which PVE refuses with "interface already exists": loud, and it changes nothing.
   */
  const liveType = text(live['type']);
  if (liveType !== '' && liveType !== props.type) return undefined;
  return {
    active: bool(live['active']),
    autostart: bool(live['autostart']),
    'bond-primary': text(live['bond-primary']),
    bond_miimon: text(live['bond_miimon']),
    bond_mode: text(live['bond_mode']),
    bond_xmit_hash_policy: text(live['bond_xmit_hash_policy']),
    bridge_fd: text(live['bridge_fd']),
    bridge_ports: ifaceList(live['bridge_ports']),
    bridge_stp: text(live['bridge_stp']),
    bridge_vids: ifaceList(live['bridge_vids']),
    bridge_vlan_aware: bool(live['bridge_vlan_aware']),
    /** ⚠️ DERIVED BY THE READER from address+netmask, and always present when an address is. */
    cidr: text(live['cidr']),
    comments: comment(live['comments']),
    exists: bool(live['exists']),
    families: Array.isArray(live['families']) ? live['families'].join(',') : '',
    gateway: text(live['gateway']),
    iface: props.iface,
    method: text(live['method']),
    mtu: int(live['mtu'], UNSET),
    node: props.node,
    priority: int(live['priority'], UNSET),
    slaves: ifaceList(live['slaves']),
    type: liveType === '' ? props.type : liveType,
    'vlan-id': int(live['vlan-id'], UNSET),
    'vlan-raw-device': text(live['vlan-raw-device']),
  };
};
