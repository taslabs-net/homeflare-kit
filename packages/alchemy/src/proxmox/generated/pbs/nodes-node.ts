/**
 * Generated proxmox-backup-server API types for `/nodes/node` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/config — `data` payload after client unwrap. */
export type NodesNodeConfigGetReturn = {
  acme?: string;
  acmedomain0?: string;
  acmedomain1?: string;
  acmedomain2?: string;
  acmedomain3?: string;
  acmedomain4?: string;
  'ciphers-tls-1.2'?: string;
  'ciphers-tls-1.3'?: string;
  'consent-text'?: string;
  'default-lang'?:
    | 'ar'
    | 'ca'
    | 'da'
    | 'de'
    | 'en'
    | 'es'
    | 'eu'
    | 'fa'
    | 'fr'
    | 'gl'
    | 'he'
    | 'hu'
    | 'it'
    | 'ja'
    | 'kr'
    | 'nb'
    | 'nl'
    | 'nn'
    | 'pl'
    | 'pt_BR'
    | 'ru'
    | 'sl'
    | 'sv'
    | 'tr'
    | 'zh_CN'
    | 'zh_TW';
  description?: string;
  'email-from'?: string;
  'http-proxy'?: string;
  location?: string;
  'task-log-max-days'?: number;
};

/** PUT /nodes/{node}/config — form/query parameters (path segments omitted). */
export type NodesNodeConfigPutParams = {
  acme?: string;
  acmedomain0?: string;
  acmedomain1?: string;
  acmedomain2?: string;
  acmedomain3?: string;
  acmedomain4?: string;
  'ciphers-tls-1.2'?: string;
  'ciphers-tls-1.3'?: string;
  'consent-text'?: string;
  'default-lang'?:
    | 'ar'
    | 'ca'
    | 'da'
    | 'de'
    | 'en'
    | 'es'
    | 'eu'
    | 'fa'
    | 'fr'
    | 'gl'
    | 'he'
    | 'hu'
    | 'it'
    | 'ja'
    | 'kr'
    | 'nb'
    | 'nl'
    | 'nn'
    | 'pl'
    | 'pt_BR'
    | 'ru'
    | 'sl'
    | 'sv'
    | 'tr'
    | 'zh_CN'
    | 'zh_TW';
  delete?: readonly (
    | 'acme'
    | 'acmedomain0'
    | 'acmedomain1'
    | 'acmedomain2'
    | 'acmedomain3'
    | 'acmedomain4'
    | 'http-proxy'
    | 'email-from'
    | 'ciphers-tls-1.3'
    | 'ciphers-tls-1.2'
    | 'default-lang'
    | 'description'
    | 'task-log-max-days'
    | 'consent-text'
    | 'location')[];
  description?: string;
  digest?: string;
  'email-from'?: string;
  'http-proxy'?: string;
  location?: string;
  'task-log-max-days'?: `${number}`;
};
/** PUT /nodes/{node}/config — `data` payload after client unwrap. */
export type NodesNodeConfigPutReturn = null;

/** GET /nodes/{node}/disks — `data` payload after client unwrap. */
export type NodesNodeDisksGetReturn = null;

/** GET /nodes/{node}/disks/directory — `data` payload after client unwrap. */
export type NodesNodeDisksDirectoryGetReturn = readonly {
  device: string;
  filesystem?: 'ext4' | 'xfs';
  name: string;
  options?: string;
  path: string;
  removable: boolean | 0 | 1;
  unitfile: string;
}[];

/** POST /nodes/{node}/disks/directory — form/query parameters (path segments omitted). */
export type NodesNodeDisksDirectoryPostParams = {
  'add-datastore'?: '0' | '1';
  disk: string;
  filesystem?: 'ext4' | 'xfs';
  name: string;
  'removable-datastore'?: '0' | '1';
};
/** POST /nodes/{node}/disks/directory — `data` payload after client unwrap. */
export type NodesNodeDisksDirectoryPostReturn = string;

/** DELETE /nodes/{node}/disks/directory/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksDirectoryNameDeleteReturn = null;

/** POST /nodes/{node}/disks/initgpt — form/query parameters (path segments omitted). */
export type NodesNodeDisksInitgptPostParams = { disk: string; uuid?: string };
/** POST /nodes/{node}/disks/initgpt — `data` payload after client unwrap. */
export type NodesNodeDisksInitgptPostReturn = string;

/** GET /nodes/{node}/disks/list — form/query parameters (path segments omitted). */
export type NodesNodeDisksListGetParams = {
  'include-partitions'?: '0' | '1';
  skipsmart?: '0' | '1';
  'usage-type'?:
    | 'unused'
    | 'mounted'
    | 'lvm'
    | 'zfs'
    | 'devicemapper'
    | 'partitions'
    | 'filesystem';
};
/** GET /nodes/{node}/disks/list — `data` payload after client unwrap. */
export type NodesNodeDisksListGetReturn = readonly {
  devpath?: string;
  'disk-type': 'unknown' | 'hdd' | 'ssd' | 'usb';
  gpt: boolean | 0 | 1;
  model?: string;
  name: string;
  partitions?: readonly {
    devpath?: string;
    filesystem?: string;
    gpt: boolean | 0 | 1;
    mounted: boolean | 0 | 1;
    name: string;
    size?: number;
    used: 'unused' | 'lvm' | 'zfs' | 'zfsreserved' | 'efi' | 'bios' | 'filesystem';
    uuid?: string;
  }[];
  rpm?: number;
  serial?: string;
  size: number;
  status: 'passed' | 'failed' | 'unknown';
  used: 'unused' | 'mounted' | 'lvm' | 'zfs' | 'devicemapper' | 'partitions' | 'filesystem';
  vendor?: string;
  wearout?: number;
  wwn?: string;
}[];

/** GET /nodes/{node}/disks/smart — form/query parameters (path segments omitted). */
export type NodesNodeDisksSmartGetParams = { disk: string; healthonly?: '0' | '1' };
/** GET /nodes/{node}/disks/smart — `data` payload after client unwrap. */
export type NodesNodeDisksSmartGetReturn = {
  attributes: readonly {
    flags?: string;
    id?: number;
    name: string;
    normalized?: number;
    raw: string;
    threshold?: number;
    value: string;
    worst?: number;
  }[];
  status: 'passed' | 'failed' | 'unknown';
  wearout?: number;
};

/** PUT /nodes/{node}/disks/wipedisk — form/query parameters (path segments omitted). */
export type NodesNodeDisksWipediskPutParams = { disk: string };
/** PUT /nodes/{node}/disks/wipedisk — `data` payload after client unwrap. */
export type NodesNodeDisksWipediskPutReturn = string;

/** GET /nodes/{node}/disks/zfs — `data` payload after client unwrap. */
export type NodesNodeDisksZfsGetReturn = readonly {
  alloc: number;
  dedup: number;
  frag: number;
  free: number;
  health: string;
  name: string;
  size: number;
}[];

/** POST /nodes/{node}/disks/zfs — form/query parameters (path segments omitted). */
export type NodesNodeDisksZfsPostParams = {
  'add-datastore'?: '0' | '1';
  ashift?: `${number}`;
  compression?: 'gzip' | 'lz4' | 'lzjb' | 'zle' | 'zstd' | 'on' | 'off';
  devices: string;
  name: string;
  raidlevel: 'single' | 'mirror' | 'raid10' | 'raidz' | 'raidz2' | 'raidz3';
};
/** POST /nodes/{node}/disks/zfs — `data` payload after client unwrap. */
export type NodesNodeDisksZfsPostReturn = string;

/** GET /nodes/{node}/disks/zfs/{name} — `data` payload after client unwrap. */
export type NodesNodeDisksZfsNameGetReturn = Record<string, unknown>;
