/**
 * Generated pve-manager API types for `/cluster/sdn/zones` — DO NOT EDIT BY HAND.
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

/** GET /cluster/sdn/zones — form/query parameters (path segments omitted). */
export type ClusterSdnZonesGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
  type?: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
};
/** GET /cluster/sdn/zones — `data` payload after client unwrap. */
export type ClusterSdnZonesGetReturn = readonly ({
  'advertise-subnets'?: boolean | 0 | 1;
  bridge?: string;
  'bridge-disable-mac-learning'?: boolean | 0 | 1;
  controller?: string;
  dhcp?: 'dnsmasq';
  digest?: string;
  'disable-arp-nd-suppression'?: boolean | 0 | 1;
  dns?: string;
  dnszone?: string;
  exitnodes?: string;
  'exitnodes-local-routing'?: boolean | 0 | 1;
  'exitnodes-primary'?: string;
  ipam?: string;
  mac?: string;
  mtu?: number;
  nodes?: string;
  peers?: string;
  pending?: {
    'advertise-subnets'?: boolean | 0 | 1;
    bridge?: string;
    'bridge-disable-mac-learning'?: boolean | 0 | 1;
    controller?: string;
    dhcp?: 'dnsmasq';
    'disable-arp-nd-suppression'?: boolean | 0 | 1;
    dns?: string;
    dnszone?: string;
    exitnodes?: string;
    'exitnodes-local-routing'?: boolean | 0 | 1;
    'exitnodes-primary'?: string;
    ipam?: string;
    mac?: string;
    mtu?: number;
    nodes?: string;
    peers?: string;
    reversedns?: string;
    'rt-import'?: string;
    'secondary-controllers'?: readonly string[];
    tag?: number;
    'vlan-protocol'?: '802.1q' | '802.1ad';
    'vrf-vxlan'?: number;
    'vxlan-port'?: number;
  } & Record<string, unknown>;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: number;
  'vxlan-port'?: number;
  zone: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/zones — form/query parameters (path segments omitted). */
export type ClusterSdnZonesPostParams = {
  'advertise-subnets'?: '0' | '1';
  bridge?: string;
  'bridge-disable-mac-learning'?: '0' | '1';
  controller?: string;
  dhcp?: 'dnsmasq';
  'disable-arp-nd-suppression'?: '0' | '1';
  dns?: string;
  dnszone?: string;
  'dp-id'?: `${number}`;
  exitnodes?: string;
  'exitnodes-local-routing'?: '0' | '1';
  'exitnodes-primary'?: string;
  fabric?: string;
  ipam?: string;
  'lock-token'?: string;
  mac?: string;
  mtu?: `${number}`;
  nodes?: string;
  peers?: string;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  tag?: `${number}`;
  type: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: `${number}`;
  'vxlan-port'?: `${number}`;
  zone: string;
};
/** POST /cluster/sdn/zones — `data` payload after client unwrap. */
export type ClusterSdnZonesPostReturn = null;

/** GET /cluster/sdn/zones/{zone} — form/query parameters (path segments omitted). */
export type ClusterSdnZonesZoneGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/zones/{zone} — `data` payload after client unwrap. */
export type ClusterSdnZonesZoneGetReturn = {
  'advertise-subnets'?: boolean | 0 | 1;
  bridge?: string;
  'bridge-disable-mac-learning'?: boolean | 0 | 1;
  controller?: string;
  dhcp?: 'dnsmasq';
  digest?: string;
  'disable-arp-nd-suppression'?: boolean | 0 | 1;
  dns?: string;
  dnszone?: string;
  exitnodes?: string;
  'exitnodes-local-routing'?: boolean | 0 | 1;
  'exitnodes-primary'?: string;
  ipam?: string;
  mac?: string;
  mtu?: number;
  nodes?: string;
  peers?: string;
  pending?: {
    'advertise-subnets'?: boolean | 0 | 1;
    bridge?: string;
    'bridge-disable-mac-learning'?: boolean | 0 | 1;
    controller?: string;
    dhcp?: 'dnsmasq';
    'disable-arp-nd-suppression'?: boolean | 0 | 1;
    dns?: string;
    dnszone?: string;
    exitnodes?: string;
    'exitnodes-local-routing'?: boolean | 0 | 1;
    'exitnodes-primary'?: string;
    ipam?: string;
    mac?: string;
    mtu?: number;
    nodes?: string;
    peers?: string;
    reversedns?: string;
    'rt-import'?: string;
    'secondary-controllers'?: readonly string[];
    tag?: number;
    'vlan-protocol'?: '802.1q' | '802.1ad';
    'vrf-vxlan'?: number;
    'vxlan-port'?: number;
  } & Record<string, unknown>;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'evpn' | 'faucet' | 'qinq' | 'simple' | 'vlan' | 'vxlan';
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: number;
  'vxlan-port'?: number;
  zone: string;
} & Record<string, unknown>;

/** PUT /cluster/sdn/zones/{zone} — form/query parameters (path segments omitted). */
export type ClusterSdnZonesZonePutParams = {
  'advertise-subnets'?: '0' | '1';
  bridge?: string;
  'bridge-disable-mac-learning'?: '0' | '1';
  controller?: string;
  delete?: string;
  dhcp?: 'dnsmasq';
  digest?: string;
  'disable-arp-nd-suppression'?: '0' | '1';
  dns?: string;
  dnszone?: string;
  'dp-id'?: `${number}`;
  exitnodes?: string;
  'exitnodes-local-routing'?: '0' | '1';
  'exitnodes-primary'?: string;
  fabric?: string;
  ipam?: string;
  'lock-token'?: string;
  mac?: string;
  mtu?: `${number}`;
  nodes?: string;
  peers?: string;
  reversedns?: string;
  'rt-import'?: string;
  'secondary-controllers'?: readonly string[];
  tag?: `${number}`;
  'vlan-protocol'?: '802.1q' | '802.1ad';
  'vrf-vxlan'?: `${number}`;
  'vxlan-port'?: `${number}`;
};
/** PUT /cluster/sdn/zones/{zone} — `data` payload after client unwrap. */
export type ClusterSdnZonesZonePutReturn = null;

/** DELETE /cluster/sdn/zones/{zone} — form/query parameters (path segments omitted). */
export type ClusterSdnZonesZoneDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/zones/{zone} — `data` payload after client unwrap. */
export type ClusterSdnZonesZoneDeleteReturn = null;

/** GET /cluster/status — `data` payload after client unwrap. */
export type ClusterStatusGetReturn = readonly ({
  id: string;
  ip?: string;
  level?: string;
  local?: boolean | 0 | 1;
  name: string;
  nodeid?: number;
  nodes?: number;
  online?: boolean | 0 | 1;
  quorate?: boolean | 0 | 1;
  type: 'cluster' | 'node';
  version?: number;
} & Record<string, unknown>)[];

/** GET /cluster/tasks — `data` payload after client unwrap. */
export type ClusterTasksGetReturn = readonly ({ upid: string } & Record<string, unknown>)[];
