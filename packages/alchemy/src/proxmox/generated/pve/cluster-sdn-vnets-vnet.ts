/**
 * Generated pve-manager API types for `/cluster/sdn/vnets/vnet` — DO NOT EDIT BY HAND.
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

/** GET /cluster/sdn/vnets/{vnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/vnets/{vnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetGetReturn = {
  alias?: string;
  digest?: string;
  'isolate-ports'?: boolean | 0 | 1;
  pending?: {
    alias?: string;
    'isolate-ports'?: boolean | 0 | 1;
    tag?: number;
    vlanaware?: boolean | 0 | 1;
    zone?: string;
  } & Record<string, unknown>;
  state?: 'new' | 'changed' | 'deleted';
  tag?: number;
  type: 'vnet';
  vlanaware?: boolean | 0 | 1;
  vnet: string;
  zone?: string;
} & Record<string, unknown>;

/** PUT /cluster/sdn/vnets/{vnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetPutParams = {
  alias?: string;
  delete?: string;
  digest?: string;
  'isolate-ports'?: '0' | '1';
  'lock-token'?: string;
  tag?: `${number}`;
  vlanaware?: '0' | '1';
  zone?: string;
};
/** PUT /cluster/sdn/vnets/{vnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/vnets/{vnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetDeleteReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/firewall — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/sdn/vnets/{vnet}/firewall/rules — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesGetReturn = readonly ({
  action: string;
  comment?: string;
  dest?: string;
  dport?: string;
  enable?: number;
  'icmp-type'?: string;
  iface?: string;
  ipversion?: number;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos: number;
  proto?: string;
  source?: string;
  sport?: string;
  type: string;
} & Record<string, unknown>)[];

/** POST /cluster/sdn/vnets/{vnet}/firewall/rules — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallRulesPostParams = {
  action: string;
  comment?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: `${number}`;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos?: `${number}`;
  proto?: string;
  source?: string;
  sport?: string;
  type: 'in' | 'out' | 'forward' | 'group';
};
/** POST /cluster/sdn/vnets/{vnet}/firewall/rules — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPostReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPosGetReturn = {
  action: string;
  comment?: string;
  dest?: string;
  dport?: string;
  enable?: number;
  'icmp-type'?: string;
  iface?: string;
  ipversion?: number;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  pos: number;
  proto?: string;
  source?: string;
  sport?: string;
  type: string;
} & Record<string, unknown>;

/** PUT /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallRulesPosPutParams = {
  action?: string;
  comment?: string;
  delete?: string;
  dest?: string;
  digest?: string;
  dport?: string;
  enable?: `${number}`;
  'icmp-type'?: string;
  iface?: string;
  log?: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | 'nolog';
  macro?: string;
  moveto?: `${number}`;
  proto?: string;
  source?: string;
  sport?: string;
  type?: 'in' | 'out' | 'forward' | 'group';
};
/** PUT /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPosPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallRulesPosDeleteParams = { digest?: string };
/** DELETE /cluster/sdn/vnets/{vnet}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallRulesPosDeleteReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/firewall/options — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallOptionsGetReturn = {
  enable?: boolean | 0 | 1;
  log_level_forward?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  policy_forward?: 'ACCEPT' | 'DROP';
} & Record<string, unknown>;

/** PUT /cluster/sdn/vnets/{vnet}/firewall/options — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetFirewallOptionsPutParams = {
  delete?: string;
  digest?: string;
  enable?: '0' | '1';
  log_level_forward?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  policy_forward?: 'ACCEPT' | 'DROP';
};
/** PUT /cluster/sdn/vnets/{vnet}/firewall/options — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetFirewallOptionsPutReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/subnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsGetParams = { pending?: '0' | '1'; running?: '0' | '1' };
/** GET /cluster/sdn/vnets/{vnet}/subnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsGetReturn = readonly Record<string, unknown>[];

/** POST /cluster/sdn/vnets/{vnet}/subnets — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsPostParams = {
  'dhcp-dns-server'?: string;
  'dhcp-range'?: readonly string[];
  dnszoneprefix?: string;
  gateway?: string;
  'lock-token'?: string;
  snat?: '0' | '1';
  subnet: string;
  type: 'subnet';
};
/** POST /cluster/sdn/vnets/{vnet}/subnets — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsPostReturn = null;

/** GET /cluster/sdn/vnets/{vnet}/subnets/{subnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsSubnetGetParams = {
  pending?: '0' | '1';
  running?: '0' | '1';
};
/** GET /cluster/sdn/vnets/{vnet}/subnets/{subnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsSubnetGetReturn = unknown;

/** PUT /cluster/sdn/vnets/{vnet}/subnets/{subnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsSubnetPutParams = {
  delete?: string;
  'dhcp-dns-server'?: string;
  'dhcp-range'?: readonly string[];
  digest?: string;
  dnszoneprefix?: string;
  gateway?: string;
  'lock-token'?: string;
  snat?: '0' | '1';
};
/** PUT /cluster/sdn/vnets/{vnet}/subnets/{subnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsSubnetPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet}/subnets/{subnet} — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetSubnetsSubnetDeleteParams = { 'lock-token'?: string };
/** DELETE /cluster/sdn/vnets/{vnet}/subnets/{subnet} — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetSubnetsSubnetDeleteReturn = null;

/** POST /cluster/sdn/vnets/{vnet}/ips — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetIpsPostParams = { ip: string; mac?: string; zone: string };
/** POST /cluster/sdn/vnets/{vnet}/ips — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetIpsPostReturn = null;

/** PUT /cluster/sdn/vnets/{vnet}/ips — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetIpsPutParams = {
  ip: string;
  mac?: string;
  vmid?: `${number}`;
  zone: string;
};
/** PUT /cluster/sdn/vnets/{vnet}/ips — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetIpsPutReturn = null;

/** DELETE /cluster/sdn/vnets/{vnet}/ips — form/query parameters (path segments omitted). */
export type ClusterSdnVnetsVnetIpsDeleteParams = { ip: string; mac?: string; zone: string };
/** DELETE /cluster/sdn/vnets/{vnet}/ips — `data` payload after client unwrap. */
export type ClusterSdnVnetsVnetIpsDeleteReturn = null;
