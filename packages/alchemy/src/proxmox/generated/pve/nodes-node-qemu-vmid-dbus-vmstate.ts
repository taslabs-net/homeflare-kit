/**
 * Generated pve-manager API types for `/nodes/node/qemu/vmid/dbus/vmstate` — DO NOT EDIT BY HAND.
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

/** POST /nodes/{node}/qemu/{vmid}/dbus-vmstate — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidDbusVmstatePostParams = { action: 'start' | 'stop' };
/** POST /nodes/{node}/qemu/{vmid}/dbus-vmstate — `data` payload after client unwrap. */
export type NodesNodeQemuVmidDbusVmstatePostReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/feature — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFeatureGetParams = {
  feature: 'snapshot' | 'clone' | 'copy';
  snapname?: string;
};
/** GET /nodes/{node}/qemu/{vmid}/feature — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFeatureGetReturn = {
  hasFeature: boolean | 0 | 1;
  nodes: readonly string[];
} & Record<string, unknown>;

/** GET /nodes/{node}/qemu/{vmid}/firewall — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/qemu/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/firewall/aliases — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallAliasesPostParams = {
  cidr: string;
  comment?: string;
  name: string;
};
/** POST /nodes/{node}/qemu/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesPostReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesNameGetReturn = unknown;

/** PUT /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallAliasesNamePutParams = {
  cidr: string;
  comment?: string;
  digest?: string;
  rename?: string;
};
/** PUT /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesNamePutReturn = null;

/** DELETE /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallAliasesNameDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/qemu/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallAliasesNameDeleteReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetGetReturn = readonly ({
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetPostParams = {
  comment?: string;
  digest?: string;
  name: string;
  rename?: string;
};
/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetPostReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  nomatch?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNamePostParams = {
  cidr: string;
  comment?: string;
  nomatch?: '0' | '1';
};
/** POST /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNamePostReturn = null;

/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNameDeleteParams = { force?: '0' | '1' };
/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameDeleteReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameCidrGetReturn = unknown;

/** PUT /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNameCidrPutParams = {
  comment?: string;
  digest?: string;
  nomatch?: '0' | '1';
};
/** PUT /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameCidrPutReturn = null;

/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallIpsetNameCidrDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallIpsetNameCidrDeleteReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/log — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallLogGetParams = {
  limit?: `${number}`;
  since?: `${number}`;
  start?: `${number}`;
  until?: `${number}`;
};
/** GET /nodes/{node}/qemu/{vmid}/firewall/log — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallLogGetReturn = readonly ({
  n: number;
  t: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/qemu/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallOptionsGetReturn = {
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

/** PUT /nodes/{node}/qemu/{vmid}/firewall/options — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallOptionsPutParams = {
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
/** PUT /nodes/{node}/qemu/{vmid}/firewall/options — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallOptionsPutReturn = null;

/** GET /nodes/{node}/qemu/{vmid}/firewall/refs — form/query parameters (path segments omitted). */
export type NodesNodeQemuVmidFirewallRefsGetParams = { type?: 'alias' | 'ipset' };
/** GET /nodes/{node}/qemu/{vmid}/firewall/refs — `data` payload after client unwrap. */
export type NodesNodeQemuVmidFirewallRefsGetReturn = readonly ({
  comment?: string;
  name: string;
  ref: string;
  scope: string;
  type: 'alias' | 'ipset';
} & Record<string, unknown>)[];
