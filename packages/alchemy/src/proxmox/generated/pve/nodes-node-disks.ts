/**
 * Generated pve-manager API types for `/nodes/node/disks` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/disks — `data` payload after client unwrap. */
export type NodesNodeDisksGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/disks/lvm — `data` payload after client unwrap. */
export type NodesNodeDisksLvmGetReturn = {
  children: readonly ({
    children?: readonly ({
      free: number;
      leaf: boolean | 0 | 1;
      name: string;
      size: number;
    } & Record<string, unknown>)[];
    free: number;
    leaf: boolean | 0 | 1;
    name: string;
    size: number;
  } & Record<string, unknown>)[];
  leaf: boolean | 0 | 1;
} & Record<string, unknown>;

/** POST /nodes/{node}/disks/lvm — form/query parameters (path segments omitted). */
export type NodesNodeDisksLvmPostParams = { add_storage?: '0' | '1'; device: string; name: string };
/** POST /nodes/{node}/disks/lvm — `data` payload after client unwrap. */
export type NodesNodeDisksLvmPostReturn = string;

/** DELETE /nodes/{node}/disks/lvm/{name} — form/query parameters (path segments omitted). */
export type NodesNodeDisksLvmNameDeleteParams = {
  'cleanup-config'?: '0' | '1';
  'cleanup-disks'?: '0' | '1';
};
/** DELETE /nodes/{node}/disks/lvm/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksLvmNameDeleteReturn = string;

/** GET /nodes/{node}/disks/lvmthin — `data` payload after client unwrap. */
export type NodesNodeDisksLvmthinGetReturn = readonly ({
  lv: string;
  lv_size: number;
  metadata_size: number;
  metadata_used: number;
  used: number;
  vg: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/disks/lvmthin — form/query parameters (path segments omitted). */
export type NodesNodeDisksLvmthinPostParams = {
  add_storage?: '0' | '1';
  device: string;
  name: string;
};
/** POST /nodes/{node}/disks/lvmthin — `data` payload after client unwrap. */
export type NodesNodeDisksLvmthinPostReturn = string;

/** DELETE /nodes/{node}/disks/lvmthin/{name} — form/query parameters (path segments omitted). */
export type NodesNodeDisksLvmthinNameDeleteParams = {
  'cleanup-config'?: '0' | '1';
  'cleanup-disks'?: '0' | '1';
  'volume-group': string;
};
/** DELETE /nodes/{node}/disks/lvmthin/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksLvmthinNameDeleteReturn = string;

/** GET /nodes/{node}/disks/directory — `data` payload after client unwrap. */
export type NodesNodeDisksDirectoryGetReturn = readonly ({
  device: string;
  options: string;
  path: string;
  type: string;
  unitfile: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/disks/directory — form/query parameters (path segments omitted). */
export type NodesNodeDisksDirectoryPostParams = {
  add_storage?: '0' | '1';
  device: string;
  filesystem?: 'ext4' | 'xfs';
  name: string;
};
/** POST /nodes/{node}/disks/directory — `data` payload after client unwrap. */
export type NodesNodeDisksDirectoryPostReturn = string;

/** DELETE /nodes/{node}/disks/directory/{name} — form/query parameters (path segments omitted). */
export type NodesNodeDisksDirectoryNameDeleteParams = {
  'cleanup-config'?: '0' | '1';
  'cleanup-disks'?: '0' | '1';
};
/** DELETE /nodes/{node}/disks/directory/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksDirectoryNameDeleteReturn = string;

/** GET /nodes/{node}/disks/zfs — `data` payload after client unwrap. */
export type NodesNodeDisksZfsGetReturn = readonly ({
  alloc: number;
  dedup: number;
  frag: number;
  free: number;
  health: string;
  name: string;
  size: number;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/disks/zfs — form/query parameters (path segments omitted). */
export type NodesNodeDisksZfsPostParams = {
  add_storage?: '0' | '1';
  ashift?: `${number}`;
  compression?: 'on' | 'off' | 'gzip' | 'lz4' | 'lzjb' | 'zle' | 'zstd';
  devices: string;
  'draid-config'?: string;
  name: string;
  raidlevel:
    | 'single'
    | 'mirror'
    | 'raid10'
    | 'raidz'
    | 'raidz2'
    | 'raidz3'
    | 'draid'
    | 'draid2'
    | 'draid3';
};
/** POST /nodes/{node}/disks/zfs — `data` payload after client unwrap. */
export type NodesNodeDisksZfsPostReturn = string;

/** GET /nodes/{node}/disks/zfs/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksZfsNameGetReturn = {
  action?: string;
  children: readonly ({
    cksum?: number;
    msg: string;
    name: string;
    read?: number;
    state?: string;
    write?: number;
  } & Record<string, unknown>)[];
  errors: string;
  name: string;
  scan?: string;
  state: string;
  status?: string;
} & Record<string, unknown>;

/** DELETE /nodes/{node}/disks/zfs/{name} — form/query parameters (path segments omitted). */
export type NodesNodeDisksZfsNameDeleteParams = {
  'cleanup-config'?: '0' | '1';
  'cleanup-disks'?: '0' | '1';
};
/** DELETE /nodes/{node}/disks/zfs/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksZfsNameDeleteReturn = string;

/** GET /nodes/{node}/disks/list — form/query parameters (path segments omitted). */
export type NodesNodeDisksListGetParams = {
  'include-partitions'?: '0' | '1';
  skipsmart?: '0' | '1';
  type?: 'unused' | 'journal_disks';
};
/** GET /nodes/{node}/disks/list — `data` payload after client unwrap. */
export type NodesNodeDisksListGetReturn = readonly ({
  devpath: string;
  gpt: boolean | 0 | 1;
  health?: string;
  model?: string;
  mounted: boolean | 0 | 1;
  osdid: number;
  'osdid-list': readonly number[];
  parent?: string;
  serial?: string;
  size: number;
  used?: string;
  vendor?: string;
  wwn?: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/disks/smart — form/query parameters (path segments omitted). */
export type NodesNodeDisksSmartGetParams = { disk: string; healthonly?: '0' | '1' };
/** GET /nodes/{node}/disks/smart — `data` payload after client unwrap. */
export type NodesNodeDisksSmartGetReturn = {
  attributes?: readonly unknown[];
  health: string;
  text?: string;
  type?: string;
} & Record<string, unknown>;

/** POST /nodes/{node}/disks/initgpt — form/query parameters (path segments omitted). */
export type NodesNodeDisksInitgptPostParams = { disk: string; uuid?: string };
/** POST /nodes/{node}/disks/initgpt — `data` payload after client unwrap. */
export type NodesNodeDisksInitgptPostReturn = string;

/** PUT /nodes/{node}/disks/wipedisk — form/query parameters (path segments omitted). */
export type NodesNodeDisksWipediskPutParams = { disk: string };
/** PUT /nodes/{node}/disks/wipedisk — `data` payload after client unwrap. */
export type NodesNodeDisksWipediskPutReturn = string;

/** GET /nodes/{node}/dns — `data` payload after client unwrap. */
export type NodesNodeDnsGetReturn = {
  dns1?: string;
  dns2?: string;
  dns3?: string;
  search?: string;
};

/** PUT /nodes/{node}/dns — form/query parameters (path segments omitted). */
export type NodesNodeDnsPutParams = { dns1?: string; dns2?: string; dns3?: string; search: string };
/** PUT /nodes/{node}/dns — `data` payload after client unwrap. */
export type NodesNodeDnsPutReturn = null;

/** POST /nodes/{node}/execute — form/query parameters (path segments omitted). */
export type NodesNodeExecutePostParams = { commands: string };
/** POST /nodes/{node}/execute — `data` payload after client unwrap. */
export type NodesNodeExecutePostReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/firewall — `data` payload after client unwrap. */
export type NodesNodeFirewallGetReturn = readonly Record<string, unknown>[];

/** GET /nodes/{node}/firewall/log — form/query parameters (path segments omitted). */
export type NodesNodeFirewallLogGetParams = {
  limit?: `${number}`;
  since?: `${number}`;
  start?: `${number}`;
  until?: `${number}`;
};
/** GET /nodes/{node}/firewall/log — `data` payload after client unwrap. */
export type NodesNodeFirewallLogGetReturn = readonly ({
  n: number;
  t: string;
} & Record<string, unknown>)[];
