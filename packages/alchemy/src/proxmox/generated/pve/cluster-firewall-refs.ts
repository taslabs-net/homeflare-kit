/**
 * Generated pve-manager API types for `/cluster/firewall/refs` — DO NOT EDIT BY HAND.
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

/** GET /cluster/firewall/refs — form/query parameters (path segments omitted). */
export type ClusterFirewallRefsGetParams = { type?: 'alias' | 'ipset' };
/** GET /cluster/firewall/refs — `data` payload after client unwrap. */
export type ClusterFirewallRefsGetReturn = readonly ({
  comment?: string;
  name: string;
  ref: string;
  scope: string;
  type: 'alias' | 'ipset';
} & Record<string, unknown>)[];

/** GET /cluster/firewall/rules — `data` payload after client unwrap. */
export type ClusterFirewallRulesGetReturn = readonly ({
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

/** POST /cluster/firewall/rules — form/query parameters (path segments omitted). */
export type ClusterFirewallRulesPostParams = {
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
/** POST /cluster/firewall/rules — `data` payload after client unwrap. */
export type ClusterFirewallRulesPostReturn = null;

/** GET /cluster/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterFirewallRulesPosGetReturn = {
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

/** PUT /cluster/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type ClusterFirewallRulesPosPutParams = {
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
/** PUT /cluster/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterFirewallRulesPosPutReturn = null;

/** DELETE /cluster/firewall/rules/{pos} — form/query parameters (path segments omitted). */
export type ClusterFirewallRulesPosDeleteParams = { digest?: string };
/** DELETE /cluster/firewall/rules/{pos} — `data` payload after client unwrap. */
export type ClusterFirewallRulesPosDeleteReturn = null;
