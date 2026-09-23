/**
 * Generated pve-manager API types for `/nodes/node/lxc/vmid/firewall` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/lxc/{vmid}/firewall/log — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallLogGetParams = {
  limit?: `${number}`;
  since?: `${number}`;
  start?: `${number}`;
  until?: `${number}`;
};
/** GET /nodes/{node}/lxc/{vmid}/firewall/log — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallLogGetReturn = readonly ({
  n: number;
  t: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/lxc/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallOptionsGetReturn = {
  dhcp?: boolean | 0 | 1;
  enable?: boolean | 0 | 1;
  ipfilter?: boolean | 0 | 1;
  log_level_in?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  log_level_out?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  macfilter?: boolean | 0 | 1;
  ndp?: boolean | 0 | 1;
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
  radv?: boolean | 0 | 1;
} & Record<string, unknown>;

/** PUT /nodes/{node}/lxc/{vmid}/firewall/options — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallOptionsPutParams = {
  delete?: string;
  dhcp?: '0' | '1';
  digest?: string;
  enable?: '0' | '1';
  ipfilter?: '0' | '1';
  log_level_in?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  log_level_out?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  macfilter?: '0' | '1';
  ndp?: '0' | '1';
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
  radv?: '0' | '1';
};
/** PUT /nodes/{node}/lxc/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallOptionsPutReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/refs — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRefsGetParams = { type?: 'alias' | 'ipset' };
/** GET /nodes/{node}/lxc/{vmid}/firewall/refs — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRefsGetReturn = readonly ({
  comment?: string;
  name: string;
  ref: string;
  scope: string;
  type: 'alias' | 'ipset';
} & Record<string, unknown>)[];

/** GET /nodes/{node}/lxc/{vmid}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesGetReturn = readonly ({
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

/** POST /nodes/{node}/lxc/{vmid}/firewall/rules — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRulesPostParams = {
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
/** POST /nodes/{node}/lxc/{vmid}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPostReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPosGetReturn = {
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

/** PUT /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRulesPosPutParams = {
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
/** PUT /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPosPutReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallRulesPosDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallRulesPosDeleteReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/interfaces — `data` payload after client unwrap. */
export type NodesNodeLxcVmidInterfacesGetReturn = readonly ({
  'hardware-address': string;
  hwaddr: string;
  inet?: string;
  inet6?: string;
  'ip-addresses': readonly ({
    'ip-address'?: string;
    'ip-address-type'?: string;
    prefix?: number;
  } & Record<string, unknown>)[];
  name: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/lxc/{vmid}/migrate — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMigrateGetParams = { target?: string };
/** GET /nodes/{node}/lxc/{vmid}/migrate — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMigrateGetReturn = {
  'allowed-nodes'?: readonly string[];
  'dependent-ha-resources'?: readonly string[];
  'not-allowed-nodes'?: {
    'blocking-ha-resources'?: readonly ({
      cause: 'node-affinity' | 'resource-affinity';
      sid: string;
    } & Record<string, unknown>)[];
  } & Record<string, unknown>;
  running: boolean | 0 | 1;
} & Record<string, unknown>;

/** POST /nodes/{node}/lxc/{vmid}/migrate — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidMigratePostParams = {
  bwlimit?: `${number}`;
  online?: '0' | '1';
  restart?: '0' | '1';
  target: string;
  'target-storage'?: string;
  timeout?: `${number}`;
};
/** POST /nodes/{node}/lxc/{vmid}/migrate — `data` payload after client unwrap. */
export type NodesNodeLxcVmidMigratePostReturn = string;
