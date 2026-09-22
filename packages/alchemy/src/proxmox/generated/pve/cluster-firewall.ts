/**
 * Generated pve-manager API types for `/cluster/firewall` — DO NOT EDIT BY HAND.
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

/** GET /cluster/firewall/aliases — `data` payload after client unwrap. */
export type ClusterFirewallAliasesGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /cluster/firewall/aliases — form/query parameters (path segments omitted). */
export type ClusterFirewallAliasesPostParams = { cidr: string; comment?: string; name: string };
/** POST /cluster/firewall/aliases — `data` payload after client unwrap. */
export type ClusterFirewallAliasesPostReturn = null;

/** GET /cluster/firewall/aliases/{name} — `data` payload after client unwrap. */
export type ClusterFirewallAliasesNameGetReturn = unknown;

/** PUT /cluster/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type ClusterFirewallAliasesNamePutParams = {
  cidr: string;
  comment?: string;
  digest?: string;
  rename?: string;
};
/** PUT /cluster/firewall/aliases/{name} — `data` payload after client unwrap. */
export type ClusterFirewallAliasesNamePutReturn = null;

/** DELETE /cluster/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type ClusterFirewallAliasesNameDeleteParams = { digest?: string };
/** DELETE /cluster/firewall/aliases/{name} — `data` payload after client unwrap. */
export type ClusterFirewallAliasesNameDeleteReturn = null;

/** GET /cluster/firewall/groups — `data` payload after client unwrap. */
export type ClusterFirewallGroupsGetReturn = readonly ({
  comment?: string;
  digest: string;
  group: string;
} & Record<string, unknown>)[];

/** POST /cluster/firewall/groups — form/query parameters (path segments omitted). */
export type ClusterFirewallGroupsPostParams = {
  comment?: string;
  digest?: string;
  group: string;
  rename?: string;
};
/** POST /cluster/firewall/groups — `data` payload after client unwrap. */
export type ClusterFirewallGroupsPostReturn = null;

/** GET /cluster/firewall/groups/{group} — `data` payload after client unwrap. */
export type ClusterFirewallGroupsGroupGetReturn = readonly ({
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

/** POST /cluster/firewall/groups/{group} — form/query parameters (path segments omitted). */
export type ClusterFirewallGroupsGroupPostParams = {
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
/** POST /cluster/firewall/groups/{group} — `data` payload after client unwrap. */
export type ClusterFirewallGroupsGroupPostReturn = null;

/** DELETE /cluster/firewall/groups/{group} — `data` payload after client unwrap. */
export type ClusterFirewallGroupsGroupDeleteReturn = null;

/** GET /cluster/firewall/groups/{group}/{pos} — `data` payload after client unwrap. */
export type ClusterFirewallGroupsGroupPosGetReturn = {
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

/** PUT /cluster/firewall/groups/{group}/{pos} — form/query parameters (path segments omitted). */
export type ClusterFirewallGroupsGroupPosPutParams = {
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
/** PUT /cluster/firewall/groups/{group}/{pos} — `data` payload after client unwrap. */
export type ClusterFirewallGroupsGroupPosPutReturn = null;

/** DELETE /cluster/firewall/groups/{group}/{pos} — form/query parameters (path segments omitted). */
export type ClusterFirewallGroupsGroupPosDeleteParams = { digest?: string };
/** DELETE /cluster/firewall/groups/{group}/{pos} — `data` payload after client unwrap. */
export type ClusterFirewallGroupsGroupPosDeleteReturn = null;

/** GET /cluster/firewall/ipset — `data` payload after client unwrap. */
export type ClusterFirewallIpsetGetReturn = readonly ({
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /cluster/firewall/ipset — form/query parameters (path segments omitted). */
export type ClusterFirewallIpsetPostParams = {
  comment?: string;
  digest?: string;
  name: string;
  rename?: string;
};
/** POST /cluster/firewall/ipset — `data` payload after client unwrap. */
export type ClusterFirewallIpsetPostReturn = null;

/** GET /cluster/firewall/ipset/{name} — `data` payload after client unwrap. */
export type ClusterFirewallIpsetNameGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  nomatch?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /cluster/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type ClusterFirewallIpsetNamePostParams = {
  cidr: string;
  comment?: string;
  nomatch?: '0' | '1';
};
/** POST /cluster/firewall/ipset/{name} — `data` payload after client unwrap. */
export type ClusterFirewallIpsetNamePostReturn = null;

/** DELETE /cluster/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type ClusterFirewallIpsetNameDeleteParams = { force?: '0' | '1' };
/** DELETE /cluster/firewall/ipset/{name} — `data` payload after client unwrap. */
export type ClusterFirewallIpsetNameDeleteReturn = null;

/** GET /cluster/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type ClusterFirewallIpsetNameCidrGetReturn = unknown;

/** PUT /cluster/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type ClusterFirewallIpsetNameCidrPutParams = {
  comment?: string;
  digest?: string;
  nomatch?: '0' | '1';
};
/** PUT /cluster/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type ClusterFirewallIpsetNameCidrPutReturn = null;

/** DELETE /cluster/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type ClusterFirewallIpsetNameCidrDeleteParams = { digest?: string };
/** DELETE /cluster/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type ClusterFirewallIpsetNameCidrDeleteReturn = null;

/** GET /cluster/firewall/macros — `data` payload after client unwrap. */
export type ClusterFirewallMacrosGetReturn = readonly ({
  descr: string;
  macro: string;
} & Record<string, unknown>)[];

/** GET /cluster/firewall/options — `data` payload after client unwrap. */
export type ClusterFirewallOptionsGetReturn = {
  ebtables?: boolean | 0 | 1;
  enable?: number;
  log_ratelimit?: string;
  policy_forward?: 'ACCEPT' | 'DROP';
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
} & Record<string, unknown>;

/** PUT /cluster/firewall/options — form/query parameters (path segments omitted). */
export type ClusterFirewallOptionsPutParams = {
  delete?: string;
  digest?: string;
  ebtables?: '0' | '1';
  enable?: `${number}`;
  log_ratelimit?: string;
  policy_forward?: 'ACCEPT' | 'DROP';
  policy_in?: 'ACCEPT' | 'REJECT' | 'DROP';
  policy_out?: 'ACCEPT' | 'REJECT' | 'DROP';
};
/** PUT /cluster/firewall/options — `data` payload after client unwrap. */
export type ClusterFirewallOptionsPutReturn = null;
