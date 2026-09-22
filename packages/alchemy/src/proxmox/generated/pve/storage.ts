/**
 * Generated pve-manager API types for `/storage` — DO NOT EDIT BY HAND.
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

/** GET /storage — form/query parameters (path segments omitted). */
export type StorageGetParams = {
  type?:
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
};
/** GET /storage — `data` payload after client unwrap. */
export type StorageGetReturn = readonly ({ storage: string } & Record<string, unknown>)[];

/** POST /storage — form/query parameters (path segments omitted). */
export type StoragePostParams = {
  authsupported?: string;
  base?: string;
  blocksize?: string;
  bwlimit?: string;
  comstar_hg?: string;
  comstar_tg?: string;
  content?: string;
  'content-dirs'?: string;
  'create-base-path'?: '0' | '1';
  'create-subdirs'?: '0' | '1';
  'data-pool'?: string;
  datastore?: string;
  disable?: '0' | '1';
  domain?: string;
  'encryption-key'?: string;
  export?: string;
  fingerprint?: string;
  format?: 'raw' | 'qcow2' | 'subvol' | 'vmdk';
  'fs-name'?: string;
  fuse?: '0' | '1';
  is_mountpoint?: string;
  iscsiprovider?: string;
  keyring?: string;
  krbd?: '0' | '1';
  lio_tpg?: string;
  'master-pubkey'?: string;
  'max-protected-backups'?: `${number}`;
  mkdir?: '0' | '1';
  monhost?: string;
  mountpoint?: string;
  namespace?: string;
  nocow?: '0' | '1';
  nodes?: string;
  nowritecache?: '0' | '1';
  options?: string;
  password?: string;
  path?: string;
  pool?: string;
  port?: `${number}`;
  portal?: string;
  preallocation?: 'off' | 'metadata' | 'falloc' | 'full';
  'prune-backups'?: string;
  saferemove?: '0' | '1';
  'saferemove-stepsize'?: '1' | '2' | '4' | '8' | '16' | '32';
  saferemove_throughput?: string;
  server?: string;
  share?: string;
  shared?: '0' | '1';
  'skip-cert-verification'?: '0' | '1';
  smbversion?: 'default' | '2.0' | '2.1' | '3' | '3.0' | '3.11';
  'snapshot-as-volume-chain'?: '0' | '1';
  sparse?: '0' | '1';
  storage: string;
  subdir?: string;
  tagged_only?: '0' | '1';
  target?: string;
  thinpool?: string;
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
  username?: string;
  vgname?: string;
  'zfs-base-path'?: string;
};
/** POST /storage — `data` payload after client unwrap. */
export type StoragePostReturn = {
  config?: { 'encryption-key'?: string } & Record<string, unknown>;
  storage: string;
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

/** GET /storage/{storage} — `data` payload after client unwrap. */
export type StorageStorageGetReturn = unknown;

/** PUT /storage/{storage} — form/query parameters (path segments omitted). */
export type StorageStoragePutParams = {
  blocksize?: string;
  bwlimit?: string;
  comstar_hg?: string;
  comstar_tg?: string;
  content?: string;
  'content-dirs'?: string;
  'create-base-path'?: '0' | '1';
  'create-subdirs'?: '0' | '1';
  'data-pool'?: string;
  delete?: string;
  digest?: string;
  disable?: '0' | '1';
  domain?: string;
  'encryption-key'?: string;
  fingerprint?: string;
  format?: 'raw' | 'qcow2' | 'subvol' | 'vmdk';
  'fs-name'?: string;
  fuse?: '0' | '1';
  is_mountpoint?: string;
  keyring?: string;
  krbd?: '0' | '1';
  lio_tpg?: string;
  'master-pubkey'?: string;
  'max-protected-backups'?: `${number}`;
  mkdir?: '0' | '1';
  monhost?: string;
  mountpoint?: string;
  namespace?: string;
  nocow?: '0' | '1';
  nodes?: string;
  nowritecache?: '0' | '1';
  options?: string;
  password?: string;
  pool?: string;
  port?: `${number}`;
  preallocation?: 'off' | 'metadata' | 'falloc' | 'full';
  'prune-backups'?: string;
  saferemove?: '0' | '1';
  'saferemove-stepsize'?: '1' | '2' | '4' | '8' | '16' | '32';
  saferemove_throughput?: string;
  server?: string;
  shared?: '0' | '1';
  'skip-cert-verification'?: '0' | '1';
  smbversion?: 'default' | '2.0' | '2.1' | '3' | '3.0' | '3.11';
  'snapshot-as-volume-chain'?: '0' | '1';
  sparse?: '0' | '1';
  subdir?: string;
  tagged_only?: '0' | '1';
  username?: string;
  'zfs-base-path'?: string;
};
/** PUT /storage/{storage} — `data` payload after client unwrap. */
export type StorageStoragePutReturn = {
  config?: { 'encryption-key'?: string } & Record<string, unknown>;
  storage: string;
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

/** DELETE /storage/{storage} — `data` payload after client unwrap. */
export type StorageStorageDeleteReturn = null;
