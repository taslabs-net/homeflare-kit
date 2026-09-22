/**
 * Generated pve-manager API types for `/nodes/node/lxc/vmid` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/lxc/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidConfigGetParams = { current?: '0' | '1'; snapshot?: string };
/** GET /nodes/{node}/lxc/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeLxcVmidConfigGetReturn = {
  arch?: 'amd64' | 'i386' | 'arm64' | 'armhf' | 'riscv32' | 'riscv64';
  cmode?: 'shell' | 'console' | 'tty';
  console?: boolean | 0 | 1;
  cores?: number;
  cpulimit?: number;
  cpuunits?: number;
  debug?: boolean | 0 | 1;
  description?: string;
  'dev[n]'?: string;
  digest: string;
  entrypoint?: string;
  env?: string;
  features?: string;
  hookscript?: string;
  hostname?: string;
  lock?:
    | 'backup'
    | 'create'
    | 'destroyed'
    | 'disk'
    | 'fstrim'
    | 'migrate'
    | 'mounted'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete';
  lxc?: readonly (readonly string[])[];
  memory?: number;
  'mp[n]'?: string;
  nameserver?: string;
  'net[n]'?: string;
  onboot?: boolean | 0 | 1;
  ostype?:
    | 'debian'
    | 'devuan'
    | 'ubuntu'
    | 'centos'
    | 'fedora'
    | 'opensuse'
    | 'archlinux'
    | 'alpine'
    | 'gentoo'
    | 'nixos'
    | 'unmanaged';
  protection?: boolean | 0 | 1;
  rootfs?: string;
  searchdomain?: string;
  startup?: string;
  swap?: number;
  tags?: string;
  template?: boolean | 0 | 1;
  timezone?: string;
  tty?: number;
  unprivileged?: boolean | 0 | 1;
  'unused[n]'?: string;
} & Record<string, unknown>;

/** PUT /nodes/{node}/lxc/{vmid}/config — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidConfigPutParams = {
  arch?: 'amd64' | 'i386' | 'arm64' | 'armhf' | 'riscv32' | 'riscv64';
  cmode?: 'shell' | 'console' | 'tty';
  console?: '0' | '1';
  cores?: `${number}`;
  cpulimit?: `${number}`;
  cpuunits?: `${number}`;
  debug?: '0' | '1';
  delete?: string;
  description?: string;
  'dev[n]'?: string;
  digest?: string;
  entrypoint?: string;
  env?: string;
  features?: string;
  hookscript?: string;
  hostname?: string;
  lock?:
    | 'backup'
    | 'create'
    | 'destroyed'
    | 'disk'
    | 'fstrim'
    | 'migrate'
    | 'mounted'
    | 'rollback'
    | 'snapshot'
    | 'snapshot-delete';
  memory?: `${number}`;
  'mp[n]'?: string;
  nameserver?: string;
  'net[n]'?: string;
  onboot?: '0' | '1';
  ostype?:
    | 'debian'
    | 'devuan'
    | 'ubuntu'
    | 'centos'
    | 'fedora'
    | 'opensuse'
    | 'archlinux'
    | 'alpine'
    | 'gentoo'
    | 'nixos'
    | 'unmanaged';
  protection?: '0' | '1';
  revert?: string;
  rootfs?: string;
  searchdomain?: string;
  startup?: string;
  swap?: `${number}`;
  tags?: string;
  template?: '0' | '1';
  timezone?: string;
  tty?: `${number}`;
  unprivileged?: '0' | '1';
  'unused[n]'?: string;
};
/** PUT /nodes/{node}/lxc/{vmid}/config — `data` payload after client unwrap. */
export type NodesNodeLxcVmidConfigPutReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/feature — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFeatureGetParams = {
  feature: 'snapshot' | 'clone' | 'copy';
  snapname?: string;
};
/** GET /nodes/{node}/lxc/{vmid}/feature — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFeatureGetReturn = {
  hasFeature: boolean | 0 | 1;
} & Record<string, unknown>;

/** GET /nodes/{node}/lxc/{vmid}/firewall — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/lxc/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/firewall/aliases — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallAliasesPostParams = {
  cidr: string;
  comment?: string;
  name: string;
};
/** POST /nodes/{node}/lxc/{vmid}/firewall/aliases — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesPostReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesNameGetReturn = unknown;

/** PUT /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallAliasesNamePutParams = {
  cidr: string;
  comment?: string;
  digest?: string;
  rename?: string;
};
/** PUT /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesNamePutReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallAliasesNameDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/aliases/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallAliasesNameDeleteReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetGetReturn = readonly ({
  comment?: string;
  digest: string;
  name: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetPostParams = {
  comment?: string;
  digest?: string;
  name: string;
  rename?: string;
};
/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetPostReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameGetReturn = readonly ({
  cidr: string;
  comment?: string;
  digest: string;
  nomatch?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNamePostParams = {
  cidr: string;
  comment?: string;
  nomatch?: '0' | '1';
};
/** POST /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNamePostReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNameDeleteParams = { force?: '0' | '1' };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameDeleteReturn = null;

/** GET /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameCidrGetReturn = unknown;

/** PUT /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNameCidrPutParams = {
  comment?: string;
  digest?: string;
  nomatch?: '0' | '1';
};
/** PUT /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameCidrPutReturn = null;

/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidFirewallIpsetNameCidrDeleteParams = { digest?: string };
/** DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidFirewallIpsetNameCidrDeleteReturn = null;
