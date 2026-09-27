/**
 * `Proxmox.NodeNetwork`'s READ side: the coercions in both directions, the read itself, and
 * `matches`. Split out of node-network-form.ts (2026-09-24, the distilled migration) — the
 * storage.ts/storage-wire.ts seam; the write side stays in node-network-form.ts.
 *
 * * ⛔ THE LAST SEVEN ARE REPORTED AND NEVER COMPARED, AND EACH ONE IS A MEASURED FOREVER-DIFF.
 *   `priority` is assigned by PVE FROM FILE ORDER — `my $priority = 2; ... $d->{priority} =
 *   $priority++` — and it is not a POST or PUT parameter at all. MEASURED ACROSS C1: vmbr1.42 is
 *   priority 16 on node-b and node-c and 15 on node-d, because node-d has no `wlan0` above it. One
 *   declaration reused across three nodes would diff on exactly one of them, forever, over nothing.
 *   `method` is RECOMPUTED on every write from whether the form carried an address, `families` is
 *   recomputed the same way and never written to the file, `active` and `exists` describe the
 *   kernel rather than the config, and `bond_miimon`, `bridge_stp` and `bridge_fd` are emitted by
 *   PVE's writer with defaults (100, `off`, 0) while appearing in NEITHER write schema —
 *   `additionalProperties => 0` means sending one is a 400. Live proof of all three: node-b's bond0
 *   returns `bond_miimon "100"` and vmbr1 returns `bridge_stp "off"`, `bridge_fd "0"`, none of
 *   which any declaration can set.
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import {
  type NodeNetworkProps,
  UNSET,
  comment,
  ifaceList,
  same,
  sameComment,
  sameList,
} from './node-network-form.ts';
import { UNREADABLE, type Unreadable, readOrUnreadable } from './unreadable-read.ts';
import { bool, int, text } from './values.ts';

/**
 * PVE's interface types. `unknown` is what a NIC it does not manage reports — node-b and node-c
 * both report `wlan0` that way, and node-d has no such interface at all.
 *
 * ⚠️ THAT ASYMMETRY IS A TRAP FOR A DECLARATION SHARED ACROSS NODES. On node-d the read answers
 *   400 ("interface does not exist"), which this provider cannot tell from "deleted", so
 *   reconcile POSTs — writing a stanza for a card that is not in the machine. Declare per node
 *   what each node actually has; a physical interface is discovered, not decided.
 */
export type NodeNetworkType =
  | 'OVSBond'
  | 'OVSBridge'
  | 'OVSIntPort'
  | 'OVSPort'
  | 'alias'
  | 'bond'
  | 'bridge'
  | 'eth'
  | 'fabric'
  | 'unknown'
  | 'vlan'
  | 'vnet';

/**
 * ⛔ THE LAST SEVEN ARE REPORTED AND NEVER COMPARED — each is a MEASURED forever-diff, and the
 *   evidence for every one of them is below, beside the code that reads them.
 */
export interface NodeNetworkAttributes {
  node: string;
  iface: string;
  type: string;
  cidr: string;
  gateway: string;
  autostart: boolean;
  mtu: number;
  comments: string;
  bridge_ports: string;
  bridge_vids: string;
  bridge_vlan_aware: boolean;
  slaves: string;
  bond_mode: string;
  bond_xmit_hash_policy: string;
  'bond-primary': string;
  'vlan-id': number;
  'vlan-raw-device': string;
  priority: number;
  method: string;
  families: string;
  active: boolean;
  exists: boolean;
  bond_miimon: string;
  bridge_stp: string;
  bridge_fd: string;
}

/**
 * One live interface as attributes. `live` is cast past `GetNodeNetworkResponse`'s own TS type
 * (`{method, type}`) — MEASURED: the generated schema is a lower bound, not the full shape (PVE's
 * response varies by interface type, and the apidoc this was generated from does not enumerate
 * every field it can carry), but decoding does NOT strip the extras (Effect Schema's `S.Struct` is
 * structural, not exact) — every field PVE actually returns survives to this object at runtime,
 * confirmed against the full measured `vmbr0` response below.
 *
 * ⚠️ EVERY FIELD PVE REPORTS IS CARRIED HERE, INCLUDING THE SEVEN NO DECLARATION CAN SET. A plan
 *   that cannot show `priority`, `method` or `bond_miimon` cannot explain why it is ignoring them,
 *   and the next person to read a forever-diff would start by adding them to `matches`. They are
 *   reported precisely so that they are visibly OUT of it — see the ⛔ above the module header.
 */
const attributesOf = (
  live: unknown,
  props: NodeNetworkProps,
): NodeNetworkAttributes | undefined => {
  const data = live as Record<string, unknown>;
  /**
   * ⛔ AN INTERFACE OF ANOTHER TYPE IS ANOTHER OBJECT, AND "ABSENT" IS THE SAFE ANSWER — the
   *   same call metric-server.ts makes, for a worse reason. `type` is required on the PUT and
   *   the PUT MERGES, so a declaration naming `bridge` for what is really a vlan would write
   *   `type bridge` into the stanza and PVE's writer would then emit bridge-ports and
   *   bridge-stp lines for vmbr1.42. Reporting absent instead makes reconcile POST a create,
   *   which PVE refuses with "interface already exists": loud, and it changes nothing.
   */
  const liveType = text(data['type']);
  if (liveType !== '' && liveType !== props.type) return undefined;
  return {
    active: bool(data['active']),
    autostart: bool(data['autostart']),
    'bond-primary': text(data['bond-primary']),
    bond_miimon: text(data['bond_miimon']),
    bond_mode: text(data['bond_mode']),
    bond_xmit_hash_policy: text(data['bond_xmit_hash_policy']),
    bridge_fd: text(data['bridge_fd']),
    bridge_ports: ifaceList(data['bridge_ports']),
    bridge_stp: text(data['bridge_stp']),
    bridge_vids: ifaceList(data['bridge_vids']),
    bridge_vlan_aware: bool(data['bridge_vlan_aware']),
    /** ⚠️ DERIVED BY THE READER from address+netmask, and always present when an address is. */
    cidr: text(data['cidr']),
    comments: comment(data['comments']),
    exists: bool(data['exists']),
    families: Array.isArray(data['families']) ? data['families'].join(',') : '',
    gateway: text(data['gateway']),
    iface: props.iface,
    method: text(data['method']),
    mtu: int(data['mtu'], UNSET),
    node: props.node,
    priority: int(data['priority'], UNSET),
    slaves: ifaceList(data['slaves']),
    type: liveType === '' ? props.type : liveType,
    'vlan-id': int(data['vlan-id'], UNSET),
    'vlan-raw-device': text(data['vlan-raw-device']),
  };
};

/**
 * ★ Default `read` role — `Sys.Audit` on `/nodes/{node}` (node-network.ts's header).
 * ⛔ `{ node: props.node, iface: props.iface }`, NEVER THE WHOLE `props` — storage.ts's/user.ts's
 *   own ⛔, the kit 0.31.1 regression: `GetNodeNetworkRequest`'s schema declares only `node` and
 *   `iface` (both path labels); any OTHER key on the object passed to `nodes.getNodeNetwork` is
 *   treated by distilled's `buildRequest` as an "unknown key" and JSON-encoded onto this bodyless
 *   GET, which a stricter fetch client refuses outright.
 * ⛔ A MISSING INTERFACE IS A 400, NOT A 500 AND NOT A 404 — MEASURED against the live cluster
 *   (TB4 `n2`, read-role, read-only probe, 2026-09-24): `GET /nodes/n2/network/vmbr9` answers
 *   `{"errors":{"iface":"interface does not exist"},"data":null,"message":"Parameter verification
 *   failed.\n"}` at HTTP 400 — a THIRD shape, different from every other migrated family's
 *   measured 500. `@distilled.cloud/proxmox` types this as a genuine typed error,
 *   `NetworkInterfaceNotFound` (`nodes.ts`, generated from `patches/nodes/network-errors.json`),
 *   attached ONLY to `getNodeNetwork`'s error union and matched by the SDK's own
 *   `errorEnvelope`/`matchTypedError` against the EXACT sole-field body `errors.iface ===
 *   "interface does not exist"` — the precision the code here used to check by hand
 *   (`error.errors['iface'] === '…'`) is now the SDK's own matcher contract, not this file's.
 *   Any 400 that fails that exact match (a different field, a different message, more than one
 *   field) decodes as the generic `ParameterVerificationFailed` instead, never this tag.
 * ⛔ ONLY THIS EXACT SIGNAL MEANS ABSENT, EVEN WITH THE FOLD BELOW. A different 400 reason
 *   (`ParameterVerificationFailed`), a permission gap, a network blip, or any other failure is
 *   never read as "this interface is not there" — `diff` calls this directly and propagates
 *   every one of them loudly.
 */
export const readInterfaceOrFail = (props: NodeNetworkProps) =>
  readOrUnreadable(
    runPve(
      props.target,
      'read',
      false,
      nodes.getNodeNetwork({ iface: props.iface, node: props.node }),
    ).pipe(Effect.catchTag('NetworkInterfaceNotFound', () => Effect.succeed(undefined))),
  ).pipe(
    Effect.map((live) => {
      if (live === UNREADABLE) return UNREADABLE;
      return live === undefined ? undefined : attributesOf(live, props);
    }),
  );

/**
 * ⛔ FOLDS A GENUINE READ FAILURE TO `undefined` TOO, AND ONLY `read`'s adoption/recovery branch
 *   AND `reconcile` MAY USE IT — FOUND BY ADVERSARIAL REVIEW, 2026-09-24: a first draft used
 *   `readInterfaceOrFail` (precise, non-folding) for EVERY caller, on the reasoning that a typed,
 *   parsed absence signal made folding unnecessary. That reasoning conflated two different
 *   questions: HOW PRECISELY a signal means absent (this family's is unusually precise), and
 *   WHETHER a given caller can safely treat an UNRELATED failure as "proceed as though absent"
 *   (storage.ts's/user.ts's own reasoning: a wrongful fold costs at most a redundant
 *   `createNodeNetwork` POST, refused loudly). Plan.ts's cold-start adoption probe and
 *   interrupted-create recovery, and Apply.ts's delete recovery, all call `read` with
 *   `output: undefined` and NO catch of their own (`Plan.ts` v2.0.0-beta.79 ~line 1308) — and
 *   Plan.ts fails the WHOLE PLAN, every other resource included, if that call throws. A malformed
 *   `iface` in ONE brand-new declaration (a `ParameterVerificationFailed`, DIFFERENT from the
 *   `NetworkInterfaceNotFound` absence tag) would abort `bun run plan` for the entire stack under
 *   the precise-only design,
 *   where every other migrated family instead defers that same malformed declaration to a scoped,
 *   loud refusal at apply. This restores that same fold for those three call sites.
 */
export const readInterface = (props: NodeNetworkProps) =>
  readInterfaceOrFail(props).pipe(Effect.orElseSucceed(() => undefined));

/** `read`/`reconcile` return `Attributes | undefined`; only `diff` tells `UNREADABLE` apart. */
export const dropUnreadable = (live: NodeNetworkAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;

/**
 * ⛔ `cidr` IS THE ONLY FIELD COMPARED WHEN UNDECLARED, AND THAT ASYMMETRY IS THE POINT. Every
 *   other field here follows storage.ts: undeclared means unmanaged, so it is neither sent nor
 *   compared and a plan cannot report an update no write could satisfy. `cidr` cannot be
 *   unmanaged, because PVE derives `method` from the presence of an address IN THE FORM — an
 *   omission is an edit. Comparing it unconditionally is what makes that edit visible in `plan`
 *   instead of at `ifreload` time.
 *
 * ⚠️ NOTHING IN THE REPORTED-ONLY BLOCK IS HERE, and that is what makes the C1 declaration
 *   plan as `noop` on all three nodes at once — the module header lists them and the
 *   measurement behind each.
 */
export const matches = (attributes: NodeNetworkAttributes, props: NodeNetworkProps) =>
  attributes.cidr === (props.cidr ?? '') &&
  same(props.gateway, attributes.gateway) &&
  same(props.autostart, attributes.autostart) &&
  same(props.mtu, attributes.mtu) &&
  sameComment(props.comments, attributes.comments) &&
  sameList(props.bridge_ports, attributes.bridge_ports) &&
  sameList(props.bridge_vids, attributes.bridge_vids) &&
  same(props.bridge_vlan_aware, attributes.bridge_vlan_aware) &&
  sameList(props.slaves, attributes.slaves) &&
  same(props.bond_mode, attributes.bond_mode) &&
  same(props.bond_xmit_hash_policy, attributes.bond_xmit_hash_policy) &&
  same(props['bond-primary'], attributes['bond-primary']) &&
  same(props['vlan-id'], attributes['vlan-id']) &&
  same(props['vlan-raw-device'], attributes['vlan-raw-device']);
