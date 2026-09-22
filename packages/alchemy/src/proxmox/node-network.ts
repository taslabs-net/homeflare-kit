/**
 * `Proxmox.NodeNetwork` — one stanza of a node's `/etc/network/interfaces`, declared.
 *
 * ⛔ DECLARING THIS RESOURCE IS SAFE. APPLYING IT IS A SEPARATE, DELIBERATE ACT, AND IT IS NOT
 *   PERFORMED HERE. Every write under `/nodes/{node}/network/{iface}` lands in
 *   `/etc/network/interfaces.new` and changes no running interface. MEASURED, from PVE::INotify:
 *   `$shadowfiles = { '/etc/network/interfaces' => '/etc/network/interfaces.new' }`, and
 *   `read_file` reads the SHADOW when it exists. The apply is `PUT /nodes/{node}/network`, which
 *   renames the shadow over the real file and runs `ifreload -a`; the revert is
 *   `DELETE /nodes/{node}/network`, which simply unlinks the shadow. A sibling resource models
 *   that apply — this one never calls it, exactly as `Proxmox.SdnZone` never calls
 *   `Proxmox.SdnApply`.
 *
 * ⛔ CEPH ON C1 RIDES TWO NETWORKS AND THIS API ONLY SEES ONE OF THEM. Measured from
 *   `/etc/pve/ceph.conf` on 2026-09-13:
 *
 *     public_network  = 198.51.100.0/24     -> vmbr1.42, which this resource DOES see
 *     cluster_network = 203.0.113.0/24     -> every OSD's cluster_addr: .102 / .103 / .104
 *
 *   The cluster network — OSD REPLICATION, the traffic that rebuilds a lost replica — lives on
 *   `203.0.113.10X/32` addresses carried by `tb0`, `tb1` and `dummy_c1`: the Thunderbolt mesh.
 *
 * ⛔ AND THOSE ADDRESSES ARE INVISIBLE HERE, WHICH IS THE TRAP. They are declared in
 *   `/etc/network/interfaces.d/sdn`, and PVE's network API does not parse that directory.
 *   MEASURED: `GET /nodes/node-b/network/tb0` answers `{"method":"manual","type":"eth",…}` with NO
 *   address, while `ip -br -4 addr` shows `tb0  UP  203.0.113.102/32`. So this resource reports
 *   tb0 and tb1 as address-less manual ports and will plan `noop` over them — implicitly
 *   asserting they carry no address, which is FALSE.
 *
 *   The consequence, stated plainly: declaring tb0/tb1 from what this API reports and then
 *   DESTROYING or applying over them takes out OSD replication on a cluster whose pools are
 *   size 3 / min_size 2. They read as the most boring interfaces on the node and are the two most
 *   dangerous. Leave them undeclared; if they must be managed, manage the file that actually
 *   owns them, not this resource.
 *
 * ⚠️ Two ways this file limits the damage on the interfaces it CAN see: `cidr` is compared
 *   unconditionally (the ⛔ on `matches`), and a live interface whose `type` disagrees with the
 *   declaration is reported ABSENT rather than retyped (the ⛔ in `attributes`).
 *
 * ★ THE REASON IT EXISTS IS THAT THE STAGED READ CANNOT TELL YOU THE NETWORK IS RIGHT — it can
 *   only tell you the FILE is. Once anything is staged, `GET /nodes/{node}/network/{iface}`
 *   answers from `interfaces.new`, so `matches` compares a declaration against a pending file and
 *   reports `noop` over a node whose running config has not moved. The apply resource is what
 *   closes that gap; this resource's `noop` means "the file says what you said", no more.
 *
 * ⚠️ PRIVILEGES ARE COARSER HERE THAN ANYWHERE ELSE IN THE PACKAGE: reads want `Sys.Audit` on
 *   `/nodes/{node}`, every write `Sys.Modify` on it — and there is no `/nodes/{node}/network` ACL
 *   object to scope to, so that also buys the node's services, certificates, DNS and time.
 *   Collected with every other family in docs/privileges.md.
 *
 * ★ A RECONCILE OVER A MATCHING INTERFACE IS A NO-WRITE, AND AN EARLIER DRAFT OF THIS COMMENT
 *   SAID THE OPPOSITE. `pveOperations.reconcile` gates on `matches` BEFORE the PUT
 *   (`resource.ts`: `else if (spec.updateForm !== undefined && !spec.matches(live, news))`), and
 *   the ⛔ above that line names THIS family as the reason the guard was added — adopting an
 *   interface a node already has would otherwise leave it holding a pending network change.
 *
 * ⚠️ WHAT IS STILL TRUE: when `matches` is false the PUT rewrites the whole stanza, and that can
 *   ADD lines the file did not have — a `vlan-raw-device vmbr1` under `vmbr1.42`, where PVE had
 *   been deriving it from the name. Harmless in content, and it costs nothing until somebody
 *   applies; one more reason the apply is a separate resource.
 *
 * ⚠️ `list` IS EMPTY, AND HERE THAT MATTERS MORE THAN ANYWHERE ELSE IN THIS PACKAGE. The index
 *   returns every interface the node has, `vmbr0`, `bond0` and the Ceph vlan included. Adopting
 *   them would put Alchemy one `destroy` away from staging the removal of a node's uplink — and
 *   `delete_network` has NO in-use check at all: MEASURED, it deletes the hash entry and writes
 *   the file. Adoption stays explicit.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import {
  createBody,
  readAttributes,
  same,
  sameComment,
  sameList,
  updateBody,
} from './node-network-form.ts';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';

/**
 * PVE's interface types. `unknown` is what a NIC it does not manage reports — node-b and node-c both
 * report `wlan0` that way, and node-d has no such interface at all.
 *
 * ⚠️ THAT ASYMMETRY IS A TRAP FOR A DECLARATION SHARED ACROSS NODES. On node-d the read answers 404,
 *   which this provider cannot tell from "deleted", so reconcile POSTs — writing a stanza for a
 *   card that is not in the machine. Declare per node what each node actually has; a physical
 *   interface is discovered, not decided.
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

export interface NodeNetworkProps extends WithTarget {
  /** Which node's file this stanza lives in. Interfaces are per node, never cluster-wide. */
  node: string;
  /** `vmbr0`, `bond0`, `vmbr1.42`. 2-20 characters, PVE's `pve-iface` format. */
  iface: string;
  /** ⛔ REQUIRED ON EVERY WRITE, update included, never used to retype — see `readAttributes`. */
  type: NodeNetworkType;
  /**
   * `198.51.100.12/24`. ⛔ THE ONE FIELD WITH NO UNMANAGED MODE: leaving it out is an instruction
   * to make the interface `manual`, not an instruction to leave its address alone. The ⛔ on
   * `updateBody` in node-network-form.ts has the measurement and the consequence.
   */
  cidr?: string;
  /** ⚠️ PVE allows exactly ONE default gateway per node and refuses a second with "Default
   *  gateway already exists on interface '<other>'". On C1 it is vmbr0.41's. */
  gateway?: string;
  /**
   * `auto <iface>` in the file. Absent on read means off, which is why `bool`'s fallback is used.
   * ⚠️ UNDECLARED IS UNMANAGED ON AN UPDATE AND OFF ON A CREATE — the same asymmetry storage.ts
   *   has, and it bites harder here: an interface created without `autostart` is one the node
   *   will not bring up at boot. Every C1 bridge, bond and vlan carries it.
   */
  autostart?: boolean;
  /** 1280-65520. Unset leaves the file without an `mtu` line and the kernel default in force. */
  mtu?: number;
  /** ⚠️ Round-trips only after normalisation — see `comment` in node-network-form.ts. */
  comments?: string;
  /** Space-separated, a SET: `enp87s0`, or `bond0`. ⚠️ PVE refuses a port already used elsewhere. */
  bridge_ports?: string;
  /** `2-4094`, or `2 100-200`. Only written when `bridge_vlan_aware` is on. */
  bridge_vids?: string;
  /** ⛔ A `false` here is sent as `delete=`, never as `0` — the ⛔ on `body` says why. */
  bridge_vlan_aware?: boolean;
  /**
   * A bond's members, space separated. ⚠️ THE PARAMETER IS `slaves`, NOT `bond_slaves`, in BOTH
   * directions on this PVE: MEASURED, the POST/PUT schema names only `slaves` and the GET returns
   * `"slaves":"enp2s0f0np0 enp2s0f1np1"`. `bond_slaves` appears nowhere in Network.pm here.
   */
  slaves?: string;
  bond_mode?: string;
  /** ⚠️ Only written when `bond_mode` is `balance-xor` or `802.3ad`; ignored otherwise. */
  bond_xmit_hash_policy?: string;
  /** active-backup only. Kept hyphenated because that is the wire name. */
  'bond-primary'?: string;
  /** ⚠️ DERIVED FROM A DOTTED NAME. `vmbr1.42` reports `vlan-id` 42 with no such line in the file;
   *  declaring it there is harmless but adds a line the file did not have. */
  'vlan-id'?: number;
  'vlan-raw-device'?: string;
}

/**
 * ⛔ THE LAST SEVEN ARE REPORTED AND NEVER COMPARED — each is a MEASURED forever-diff, and the
 *   evidence for every one of them is in node-network-form.ts, beside the code that reads them.
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

export interface ProxmoxNodeNetwork extends Resource<
  'Proxmox.NodeNetwork',
  NodeNetworkProps,
  NodeNetworkAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a node's only uplink cannot be rebuilt. See the ★ in resource.ts. */
export const ProxmoxNodeNetwork = Resource<ProxmoxNodeNetwork>('Proxmox.NodeNetwork', {
  defaultRemovalPolicy: 'retain',
});

const handlers = pveHandlers<NodeNetworkProps, NodeNetworkAttributes>({
  attributes: readAttributes,
  collection: (props) => `nodes/${props.node}/network`,
  /** ⚠️ No `delete` parameter on a POST — see the ⚠️ on `updateBody`. `iface` IS in the create
   *   body though, and was missing until 2026-09-22 — the 🔴 on `createBody`. */
  createForm: createBody,
  /** The vendor rules both forms are checked against at plan time — resource-spec.ts. */
  endpoint: {
    create: 'pve:POST /nodes/{node}/network',
    update: 'pve:PUT /nodes/{node}/network/{iface}',
  },
  /**
   * ⛔ `cidr` IS THE ONLY FIELD COMPARED WHEN UNDECLARED, AND THAT ASYMMETRY IS THE POINT. Every
   *   other field here follows storage.ts: undeclared means unmanaged, so it is neither sent nor
   *   compared and a plan cannot report an update no write could satisfy. `cidr` cannot be
   *   unmanaged, because PVE derives `method` from the presence of an address IN THE FORM — an
   *   omission is an edit. Comparing it unconditionally is what makes that edit visible in `plan`
   *   instead of at `ifreload` time.
   *
   * ⚠️ NOTHING IN THE REPORTED-ONLY BLOCK IS HERE, and that is what makes the C1 declaration
   *   plan as `noop` on all three nodes at once — the ⛔ above `NodeNetworkAttributes` lists them
   *   and the measurement behind each.
   */
  matches: (attributes, props) =>
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
    same(props['vlan-raw-device'], attributes['vlan-raw-device']),
  path: (props) => `nodes/${props.node}/network/${props.iface}`,
  updateForm: updateBody,
});

/**
 * ⚠️ THE DESTROY IS STAGED LIKE EVERY OTHER WRITE, WHICH MAKES IT THE ONE RECOVERABLE DESTROY IN
 *   THIS PACKAGE. It removes the stanza from `interfaces.new` and nothing else;
 *   `DELETE /nodes/{node}/network` puts the node back by unlinking that file. It becomes
 *   irreversible the moment somebody applies — and PVE performs NO in-use check before removing
 *   an interface other bridges or Ceph still stand on.
 */
export const ProxmoxNodeNetworkProvider = () =>
  Provider.effect(ProxmoxNodeNetwork, Effect.succeed(ProxmoxNodeNetwork.Provider.of(handlers)));
