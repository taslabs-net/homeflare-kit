/**
 * Generated pve-manager API types for `/nodes/node/network` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pve/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 */

/** GET /nodes/{node}/network — form/query parameters (path segments omitted). */
export type NodesNodeNetworkGetParams = {
  type?:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'any_bridge'
    | 'any_local_bridge'
    | 'include_sdn';
};
/** GET /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkGetReturn = readonly ({
  active?: boolean | 0 | 1;
  address?: string;
  address6?: string;
  autostart?: boolean | 0 | 1;
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb'
    | 'balance-slb'
    | 'lacp-balance-slb'
    | 'lacp-balance-tcp';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  'bridge-access'?: number;
  'bridge-arp-nd-suppress'?: boolean | 0 | 1;
  'bridge-learning'?: boolean | 0 | 1;
  'bridge-multicast-flood'?: boolean | 0 | 1;
  'bridge-unicast-flood'?: boolean | 0 | 1;
  bridge_ports?: string;
  bridge_vids?: string;
  bridge_vlan_aware?: boolean | 0 | 1;
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  exists?: boolean | 0 | 1;
  families?: readonly ('inet' | 'inet6')[];
  gateway?: string;
  gateway6?: string;
  iface: string;
  'link-type'?: string;
  method?: 'loopback' | 'dhcp' | 'manual' | 'static' | 'auto';
  method6?: 'loopback' | 'dhcp' | 'manual' | 'static' | 'auto';
  mtu?: number;
  netmask?: string;
  netmask6?: number;
  options?: readonly string[];
  options6?: readonly string[];
  ovs_bonds?: string;
  ovs_bridge?: string;
  ovs_options?: string;
  ovs_ports?: string;
  ovs_tag?: number;
  priority?: number;
  slaves?: string;
  type:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'unknown';
  'uplink-id'?: string;
  'vlan-id'?: number;
  'vlan-protocol'?: '802.1ad' | '802.1q';
  'vlan-raw-device'?: string;
  'vxlan-id'?: number;
  'vxlan-local-tunnelip'?: string;
  'vxlan-physdev'?: string;
  'vxlan-svcnodeip'?: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/network — form/query parameters (path segments omitted). */
export type NodesNodeNetworkPostParams = {
  address?: string;
  address6?: string;
  autostart?: '0' | '1';
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb'
    | 'balance-slb'
    | 'lacp-balance-slb'
    | 'lacp-balance-tcp';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: string;
  bridge_vids?: string;
  bridge_vlan_aware?: '0' | '1';
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  gateway?: string;
  gateway6?: string;
  iface: string;
  mtu?: `${number}`;
  netmask?: string;
  netmask6?: `${number}`;
  ovs_bonds?: string;
  ovs_bridge?: string;
  ovs_options?: string;
  ovs_ports?: string;
  ovs_tag?: `${number}`;
  slaves?: string;
  type:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'unknown';
  'vlan-id'?: `${number}`;
  'vlan-raw-device'?: string;
};
/** POST /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkPostReturn = null;

/** PUT /nodes/{node}/network — form/query parameters (path segments omitted). */
export type NodesNodeNetworkPutParams = { 'regenerate-frr'?: '0' | '1' };
/** PUT /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkPutReturn = string;

/** DELETE /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkDeleteReturn = null;

/** GET /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfaceGetReturn = {
  method: string;
  type: string;
} & Record<string, unknown>;

/** PUT /nodes/{node}/network/{iface} — form/query parameters (path segments omitted). */
export type NodesNodeNetworkIfacePutParams = {
  address?: string;
  address6?: string;
  autostart?: '0' | '1';
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb'
    | 'balance-slb'
    | 'lacp-balance-slb'
    | 'lacp-balance-tcp';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: string;
  bridge_vids?: string;
  bridge_vlan_aware?: '0' | '1';
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  delete?: string;
  gateway?: string;
  gateway6?: string;
  mtu?: `${number}`;
  netmask?: string;
  netmask6?: `${number}`;
  ovs_bonds?: string;
  ovs_bridge?: string;
  ovs_options?: string;
  ovs_ports?: string;
  ovs_tag?: `${number}`;
  slaves?: string;
  type:
    | 'bridge'
    | 'bond'
    | 'eth'
    | 'alias'
    | 'vlan'
    | 'fabric'
    | 'OVSBridge'
    | 'OVSBond'
    | 'OVSPort'
    | 'OVSIntPort'
    | 'vnet'
    | 'unknown';
  'vlan-id'?: `${number}`;
  'vlan-raw-device'?: string;
};
/** PUT /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfacePutReturn = null;

/** DELETE /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfaceDeleteReturn = null;
