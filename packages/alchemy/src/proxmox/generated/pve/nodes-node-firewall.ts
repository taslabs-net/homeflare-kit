/**
 * Generated pve-manager API types for `/nodes/node/firewall` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeFirewallOptionsGetReturn = {
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
  log_nf_conntrack?: boolean | 0 | 1;
  ndp?: boolean | 0 | 1;
  nf_conntrack_allow_invalid?: boolean | 0 | 1;
  nf_conntrack_helpers?: string;
  nf_conntrack_max?: number;
  nf_conntrack_tcp_timeout_established?: number;
  nf_conntrack_tcp_timeout_syn_recv?: number;
  nftables?: boolean | 0 | 1;
  nosmurfs?: boolean | 0 | 1;
  protection_synflood?: boolean | 0 | 1;
  protection_synflood_burst?: number;
  protection_synflood_rate?: number;
  smurf_log_level?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  tcp_flags_log_level?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  tcpflags?: boolean | 0 | 1;
} & Record<string, unknown>;

/** PUT /nodes/{node}/firewall/options — form/query parameters (path segments omitted). */
export type NodesNodeFirewallOptionsPutParams = {
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
  log_nf_conntrack?: '0' | '1';
  ndp?: '0' | '1';
  nf_conntrack_allow_invalid?: '0' | '1';
  nf_conntrack_helpers?: string;
  nf_conntrack_max?: `${number}`;
  nf_conntrack_tcp_timeout_established?: `${number}`;
  nf_conntrack_tcp_timeout_syn_recv?: `${number}`;
  nftables?: '0' | '1';
  nosmurfs?: '0' | '1';
  protection_synflood?: '0' | '1';
  protection_synflood_burst?: `${number}`;
  protection_synflood_rate?: `${number}`;
  smurf_log_level?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  tcp_flags_log_level?:
    | 'emerg'
    | 'alert'
    | 'crit'
    | 'err'
    | 'warning'
    | 'notice'
    | 'info'
    | 'debug'
    | 'nolog';
  tcpflags?: '0' | '1';
};
/** PUT /nodes/{node}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeFirewallOptionsPutReturn = null;

/** GET /nodes/{node}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeFirewallRulesGetReturn = readonly ({
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

/** POST /nodes/{node}/firewall/rules — form/query parameters (path segments omitted). */
export type NodesNodeFirewallRulesPostParams = {
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
/** POST /nodes/{node}/firewall/rules — `data` payload after client unwrap. */
export type NodesNodeFirewallRulesPostReturn = null;

/** GET /nodes/{node}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeFirewallRulesPosGetReturn = {
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

/** PUT /nodes/{node}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeFirewallRulesPosPutParams = {
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
/** PUT /nodes/{node}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeFirewallRulesPosPutReturn = null;

/** DELETE /nodes/{node}/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type NodesNodeFirewallRulesPosDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/firewall/rules/{pos} — `data` payload after client unwrap. */
export type NodesNodeFirewallRulesPosDeleteReturn = null;
