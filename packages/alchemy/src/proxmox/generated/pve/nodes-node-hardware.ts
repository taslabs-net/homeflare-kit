/**
 * Generated pve-manager API types for `/nodes/node/hardware` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/hardware — `data` payload after client unwrap. */
export type NodesNodeHardwareGetReturn = readonly ({ type: string } & Record<string, unknown>)[];

/** GET /nodes/{node}/hardware/pci — form/query parameters (path segments omitted). */
export type NodesNodeHardwarePciGetParams = { 'pci-class-blacklist'?: string; verbose?: '0' | '1' };
/** GET /nodes/{node}/hardware/pci — `data` payload after client unwrap. */
export type NodesNodeHardwarePciGetReturn = readonly ({
  class: string;
  device: string;
  device_name?: string;
  id: string;
  iommugroup: number;
  mdev?: boolean | 0 | 1;
  subsystem_device?: string;
  subsystem_device_name?: string;
  subsystem_vendor?: string;
  subsystem_vendor_name?: string;
  vendor: string;
  vendor_name?: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/hardware/pci/{pci-id-or-mapping} — `data` payload after client unwrap. */
export type NodesNodeHardwarePciPciIdOrMappingGetReturn = readonly ({
  method: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/hardware/pci/{pci-id-or-mapping}/mdev — `data` payload after client unwrap. */
export type NodesNodeHardwarePciPciIdOrMappingMdevGetReturn = readonly ({
  available: number;
  description: string;
  name?: string;
  type: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/hardware/usb — `data` payload after client unwrap. */
export type NodesNodeHardwareUsbGetReturn = readonly ({
  busnum: number;
  class: number;
  devnum: number;
  level: number;
  manufacturer?: string;
  port: number;
  prodid: string;
  product?: string;
  serial?: string;
  speed: string;
  usbpath?: string;
  vendid: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/hosts — `data` payload after client unwrap. */
export type NodesNodeHostsGetReturn = { data: string; digest?: string } & Record<string, unknown>;

/** POST /nodes/{node}/hosts — form/query parameters (path segments omitted). */
export type NodesNodeHostsPostParams = { data: string; digest?: string };
/** POST /nodes/{node}/hosts — `data` payload after client unwrap. */
export type NodesNodeHostsPostReturn = null;

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
export type NodesNodeJournalGetReturn = readonly string[];

/** GET /nodes/{node}/lxc — `data` payload after client unwrap. */
export type NodesNodeLxcGetReturn = readonly ({
  cpu?: number;
  cpus?: number;
  disk?: number;
  diskread?: number;
  diskwrite?: number;
  lock?: string;
  maxdisk?: number;
  maxmem?: number;
  maxswap?: number;
  mem?: number;
  name?: string;
  netin?: number;
  netout?: number;
  pressurecpusome?: number;
  pressureiofull?: number;
  pressureiosome?: number;
  pressurememoryfull?: number;
  pressurememorysome?: number;
  status: 'stopped' | 'running';
  tags?: string;
  template?: boolean | 0 | 1;
  uptime?: number;
  vmid: number;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/lxc — form/query parameters (path segments omitted). */
export type NodesNodeLxcPostParams = {
  arch?: 'amd64' | 'i386' | 'arm64' | 'armhf' | 'riscv32' | 'riscv64';
  bwlimit?: `${number}`;
  cmode?: 'shell' | 'console' | 'tty';
  console?: '0' | '1';
  cores?: `${number}`;
  cpulimit?: `${number}`;
  cpuunits?: `${number}`;
  debug?: '0' | '1';
  description?: string;
  'dev[n]'?: string;
  entrypoint?: string;
  env?: string;
  features?: string;
  force?: '0' | '1';
  'ha-managed'?: '0' | '1';
  hookscript?: string;
  hostname?: string;
  'ignore-unpack-errors'?: '0' | '1';
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
  ostemplate: string;
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
  password?: string;
  pool?: string;
  protection?: '0' | '1';
  restore?: '0' | '1';
  rootfs?: string;
  searchdomain?: string;
  'ssh-public-keys'?: string;
  start?: '0' | '1';
  startup?: string;
  storage?: string;
  swap?: `${number}`;
  tags?: string;
  template?: '0' | '1';
  timezone?: string;
  tty?: `${number}`;
  unique?: '0' | '1';
  unprivileged?: '0' | '1';
  'unused[n]'?: string;
  vmid: `${number}`;
};
/** POST /nodes/{node}/lxc — `data` payload after client unwrap. */
export type NodesNodeLxcPostReturn = string;

/** GET /nodes/{node}/lxc/{vmid} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** DELETE /nodes/{node}/lxc/{vmid} — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidDeleteParams = {
  'destroy-unreferenced-disks'?: '0' | '1';
  force?: '0' | '1';
  purge?: '0' | '1';
};
/** DELETE /nodes/{node}/lxc/{vmid} — `data` payload after client unwrap. */
export type NodesNodeLxcVmidDeleteReturn = string;

/** POST /nodes/{node}/lxc/{vmid}/clone — form/query parameters (path segments omitted). */
export type NodesNodeLxcVmidClonePostParams = {
  bwlimit?: `${number}`;
  description?: string;
  full?: '0' | '1';
  hostname?: string;
  newid: `${number}`;
  pool?: string;
  snapname?: string;
  storage?: string;
  target?: string;
};
/** POST /nodes/{node}/lxc/{vmid}/clone — `data` payload after client unwrap. */
export type NodesNodeLxcVmidClonePostReturn = string;
