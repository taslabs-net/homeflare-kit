/**
 * Generated pve-manager API types for `/nodes/node/storage/storage` — DO NOT EDIT BY HAND.
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

/** GET /nodes/{node}/storage/{storage} — `data` payload after client unwrap. */
export type NodesNodeStorageStorageGetReturn = readonly ({
  subdir: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/storage/{storage}/prunebackups — form/query parameters (path segments omitted). */
export type NodesNodeStorageStoragePrunebackupsGetParams = {
  'prune-backups'?: string;
  type?: 'qemu' | 'lxc';
  vmid?: `${number}`;
};
/** GET /nodes/{node}/storage/{storage}/prunebackups — `data` payload after client unwrap. */
export type NodesNodeStorageStoragePrunebackupsGetReturn = readonly ({
  ctime: number;
  mark: 'keep' | 'remove' | 'protected' | 'renamed';
  type: string;
  vmid?: number;
  volid: string;
} & Record<string, unknown>)[];

/** DELETE /nodes/{node}/storage/{storage}/prunebackups — form/query parameters (path segments omitted). */
export type NodesNodeStorageStoragePrunebackupsDeleteParams = {
  'prune-backups'?: string;
  type?: 'qemu' | 'lxc';
  vmid?: `${number}`;
};
/** DELETE /nodes/{node}/storage/{storage}/prunebackups — `data` payload after client unwrap. */
export type NodesNodeStorageStoragePrunebackupsDeleteReturn = string;

/** GET /nodes/{node}/storage/{storage}/content — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageContentGetParams = { content?: string; vmid?: `${number}` };
/** GET /nodes/{node}/storage/{storage}/content — `data` payload after client unwrap. */
export type NodesNodeStorageStorageContentGetReturn = readonly ({
  'approximate-size'?: number;
  ctime?: number;
  encrypted?: string;
  format: string;
  notes?: string;
  parent?: string;
  protected?: boolean | 0 | 1;
  size?: number;
  used?: number;
  verification?: { state: string; upid: string } & Record<string, unknown>;
  vmid?: number;
  volid: string;
} & Record<string, unknown>)[];

/** POST /nodes/{node}/storage/{storage}/content — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageContentPostParams = {
  filename: string;
  format?: 'raw' | 'qcow2' | 'subvol' | 'vmdk';
  size: string;
  vmid: `${number}`;
};
/** POST /nodes/{node}/storage/{storage}/content — `data` payload after client unwrap. */
export type NodesNodeStorageStorageContentPostReturn = string;

/** GET /nodes/{node}/storage/{storage}/content/{volume} — `data` payload after client unwrap. */
export type NodesNodeStorageStorageContentVolumeGetReturn = {
  format: string;
  notes?: string;
  path: string;
  protected?: boolean | 0 | 1;
  size: number;
  used: number;
} & Record<string, unknown>;

/** POST /nodes/{node}/storage/{storage}/content/{volume} — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageContentVolumePostParams = {
  target: string;
  target_node?: string;
};
/** POST /nodes/{node}/storage/{storage}/content/{volume} — `data` payload after client unwrap. */
export type NodesNodeStorageStorageContentVolumePostReturn = string;

/** PUT /nodes/{node}/storage/{storage}/content/{volume} — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageContentVolumePutParams = {
  notes?: string;
  protected?: '0' | '1';
};
/** PUT /nodes/{node}/storage/{storage}/content/{volume} — `data` payload after client unwrap. */
export type NodesNodeStorageStorageContentVolumePutReturn = null;

/** DELETE /nodes/{node}/storage/{storage}/content/{volume} — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageContentVolumeDeleteParams = { delay?: `${number}` };
/** DELETE /nodes/{node}/storage/{storage}/content/{volume} — `data` payload after client unwrap. */
export type NodesNodeStorageStorageContentVolumeDeleteReturn = string;

/** GET /nodes/{node}/storage/{storage}/file-restore/list — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageFileRestoreListGetParams = { filepath: string; volume: string };
/** GET /nodes/{node}/storage/{storage}/file-restore/list — `data` payload after client unwrap. */
export type NodesNodeStorageStorageFileRestoreListGetReturn = readonly ({
  filepath: string;
  leaf: boolean | 0 | 1;
  mtime?: number;
  size?: number;
  text: string;
  type: string;
} & Record<string, unknown>)[];

/** GET /nodes/{node}/storage/{storage}/file-restore/download — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageFileRestoreDownloadGetParams = {
  filepath: string;
  tar?: '0' | '1';
  volume: string;
};
/** GET /nodes/{node}/storage/{storage}/file-restore/download — `data` payload after client unwrap. */
export type NodesNodeStorageStorageFileRestoreDownloadGetReturn = unknown;

/** GET /nodes/{node}/storage/{storage}/status — `data` payload after client unwrap. */
export type NodesNodeStorageStorageStatusGetReturn = {
  active?: boolean | 0 | 1;
  avail?: number;
  content: string;
  enabled?: boolean | 0 | 1;
  shared?: boolean | 0 | 1;
  total?: number;
  type: string;
  used?: number;
} & Record<string, unknown>;

/** GET /nodes/{node}/storage/{storage}/rrd — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageRrdGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  ds: string;
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year';
};
/** GET /nodes/{node}/storage/{storage}/rrd — `data` payload after client unwrap. */
export type NodesNodeStorageStorageRrdGetReturn = { filename: string } & Record<string, unknown>;

/** GET /nodes/{node}/storage/{storage}/rrddata — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageRrddataGetParams = {
  cf?: 'AVERAGE' | 'MAX';
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year';
};
/** GET /nodes/{node}/storage/{storage}/rrddata — `data` payload after client unwrap. */
export type NodesNodeStorageStorageRrddataGetReturn = readonly Record<string, unknown>[];

/** POST /nodes/{node}/storage/{storage}/upload — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageUploadPostParams = {
  checksum?: string;
  'checksum-algorithm'?: 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
  content: 'iso' | 'vztmpl' | 'import';
  filename: string;
  tmpfilename?: string;
};
/** POST /nodes/{node}/storage/{storage}/upload — `data` payload after client unwrap. */
export type NodesNodeStorageStorageUploadPostReturn = string;

/** POST /nodes/{node}/storage/{storage}/download-url — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageDownloadUrlPostParams = {
  checksum?: string;
  'checksum-algorithm'?: 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
  compression?: string;
  content: 'iso' | 'vztmpl' | 'import';
  filename: string;
  url: string;
  'verify-certificates'?: '0' | '1';
};
/** POST /nodes/{node}/storage/{storage}/download-url — `data` payload after client unwrap. */
export type NodesNodeStorageStorageDownloadUrlPostReturn = string;

/** POST /nodes/{node}/storage/{storage}/oci-registry-pull — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageOciRegistryPullPostParams = {
  filename?: string;
  reference: string;
};
/** POST /nodes/{node}/storage/{storage}/oci-registry-pull — `data` payload after client unwrap. */
export type NodesNodeStorageStorageOciRegistryPullPostReturn = string;

/** GET /nodes/{node}/storage/{storage}/import-metadata — form/query parameters (path segments omitted). */
export type NodesNodeStorageStorageImportMetadataGetParams = { volume: string };
/** GET /nodes/{node}/storage/{storage}/import-metadata — `data` payload after client unwrap. */
export type NodesNodeStorageStorageImportMetadataGetReturn = {
  'create-args': unknown;
  disks?: unknown;
  net?: unknown;
  source: 'esxi';
  type: 'vm';
  warnings?: readonly ({
    key?: string;
    type:
      | 'cdrom-image-ignored'
      | 'efi-state-lost'
      | 'guest-is-running'
      | 'nvme-unsupported'
      | 'ova-needs-extracting'
      | 'ovmf-with-lsi-unsupported'
      | 'serial-port-socket-only';
    value?: string;
  } & Record<string, unknown>)[];
};

/** GET /nodes/{node}/storage/{storage}/identity — `data` payload after client unwrap. */
export type NodesNodeStorageStorageIdentityGetReturn = {
  id: string;
  type:
    | 'btrfs'
    | 'cephfs'
    | 'cifs'
    | 'dir'
    | 'esxi'
    | 'iscsi'
    | 'iscsidirect'
    | 'lvm'
    | 'lvmthin'
    | 'nfs'
    | 'pbs'
    | 'rbd'
    | 'zfs'
    | 'zfspool';
} & Record<string, unknown>;
