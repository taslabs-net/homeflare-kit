/**
 * Generated proxmox-backup-server API types for `/nodes/node/dns` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pbs-apidoc` — proxmox-backup-server 4.2.6-1 (running 4.2.3)
 *   sha256 274ab9f6fc075aea, read on a PBS host from
 *   /usr/share/doc/proxmox-backup/html/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pbs/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 */

/** GET /nodes/{node}/dns — `data` payload after client unwrap. */
export type NodesNodeDnsGetReturn = {
  digest: string;
  dns1?: string;
  dns2?: string;
  dns3?: string;
  search?: string;
};

/** PUT /nodes/{node}/dns — form/query parameters (path segments omitted). */
export type NodesNodeDnsPutParams = {
  delete?: readonly ('dns1' | 'dns2' | 'dns3')[];
  digest?: string;
  dns1?: string;
  dns2?: string;
  dns3?: string;
  search?: string;
};
/** PUT /nodes/{node}/dns — `data` payload after client unwrap. */
export type NodesNodeDnsPutReturn = null;

/** GET /nodes/{node}/identity — `data` payload after client unwrap. */
export type NodesNodeIdentityGetReturn = { 'pbs-instance-id': string };

/** GET /nodes/{node}/journal — form/query parameters (path segments omitted). */
export type NodesNodeJournalGetParams = {
  endcursor?: string;
  identifiers?: '0' | '1';
  kernel?: '0' | '1';
  lastentries?: `${number}`;
  priority?: string;
  service?: string;
  since?: `${number}`;
  startcursor?: string;
  structured?: '0' | '1';
  unit?: string;
  units?: '0' | '1';
  until?: `${number}`;
};
/** GET /nodes/{node}/journal — `data` payload after client unwrap. */
export type NodesNodeJournalGetReturn = null;

/** GET /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkGetReturn = readonly {
  active: boolean | 0 | 1;
  altnames: readonly string[];
  autostart: boolean | 0 | 1;
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: readonly string[];
  bridge_vlan_aware?: boolean | 0 | 1;
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  gateway?: string;
  gateway6?: string;
  method?: 'manual' | 'static' | 'dhcp' | 'loopback';
  method6?: 'manual' | 'static' | 'dhcp' | 'loopback';
  mtu?: number;
  name: string;
  options: readonly string[];
  options6: readonly string[];
  slaves?: readonly string[];
  type: 'loopback' | 'eth' | 'bridge' | 'bond' | 'vlan' | 'alias' | 'unknown';
  'vlan-id'?: number;
  'vlan-raw-device'?: string;
}[];

/** POST /nodes/{node}/network — form/query parameters (path segments omitted). */
export type NodesNodeNetworkPostParams = {
  autostart?: '0' | '1';
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: string;
  bridge_vlan_aware?: '0' | '1';
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  gateway?: string;
  gateway6?: string;
  iface: string;
  method?: 'manual' | 'static' | 'dhcp' | 'loopback';
  method6?: 'manual' | 'static' | 'dhcp' | 'loopback';
  mtu?: `${number}`;
  slaves?: string;
  type?: 'loopback' | 'eth' | 'bridge' | 'bond' | 'vlan' | 'alias' | 'unknown';
  'vlan-id'?: `${number}`;
  'vlan-raw-device'?: string;
};
/** POST /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkPostReturn = null;

/** PUT /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkPutReturn = null;

/** DELETE /nodes/{node}/network — `data` payload after client unwrap. */
export type NodesNodeNetworkDeleteReturn = null;

/** GET /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfaceGetReturn = {
  active: boolean | 0 | 1;
  altnames: readonly string[];
  autostart: boolean | 0 | 1;
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: readonly string[];
  bridge_vlan_aware?: boolean | 0 | 1;
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  gateway?: string;
  gateway6?: string;
  method?: 'manual' | 'static' | 'dhcp' | 'loopback';
  method6?: 'manual' | 'static' | 'dhcp' | 'loopback';
  mtu?: number;
  name: string;
  options: readonly string[];
  options6: readonly string[];
  slaves?: readonly string[];
  type: 'loopback' | 'eth' | 'bridge' | 'bond' | 'vlan' | 'alias' | 'unknown';
  'vlan-id'?: number;
  'vlan-raw-device'?: string;
};

/** PUT /nodes/{node}/network/{iface} — form/query parameters (path segments omitted). */
export type NodesNodeNetworkIfacePutParams = {
  autostart?: '0' | '1';
  'bond-primary'?: string;
  bond_mode?:
    | 'balance-rr'
    | 'active-backup'
    | 'balance-xor'
    | 'broadcast'
    | '802.3ad'
    | 'balance-tlb'
    | 'balance-alb';
  bond_xmit_hash_policy?: 'layer2' | 'layer2+3' | 'layer3+4';
  bridge_ports?: string;
  bridge_vlan_aware?: '0' | '1';
  cidr?: string;
  cidr6?: string;
  comments?: string;
  comments6?: string;
  delete?: readonly (
    | 'cidr'
    | 'cidr6'
    | 'gateway'
    | 'gateway6'
    | 'method'
    | 'method6'
    | 'comments'
    | 'comments6'
    | 'mtu'
    | 'autostart'
    | 'bridge_ports'
    | 'bridge_vlan_aware'
    | 'slaves'
    | 'bond-primary'
    | 'bond_xmit_hash_policy')[];
  digest?: string;
  gateway?: string;
  gateway6?: string;
  method?: 'manual' | 'static' | 'dhcp' | 'loopback';
  method6?: 'manual' | 'static' | 'dhcp' | 'loopback';
  mtu?: `${number}`;
  slaves?: string;
  type?: 'loopback' | 'eth' | 'bridge' | 'bond' | 'vlan' | 'alias' | 'unknown';
  'vlan-id'?: `${number}`;
  'vlan-raw-device'?: string;
};
/** PUT /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfacePutReturn = null;

/** DELETE /nodes/{node}/network/{iface} — form/query parameters (path segments omitted). */
export type NodesNodeNetworkIfaceDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/network/{iface} — `data` payload after client unwrap. */
export type NodesNodeNetworkIfaceDeleteReturn = null;

/** GET /nodes/{node}/report — `data` payload after client unwrap. */
export type NodesNodeReportGetReturn = string;

/** GET /nodes/{node}/rrd — form/query parameters (path segments omitted). */
export type NodesNodeRrdGetParams = {
  cf: 'MAX' | 'AVERAGE';
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year' | 'decade';
};
/** GET /nodes/{node}/rrd — `data` payload after client unwrap. */
export type NodesNodeRrdGetReturn = null;
