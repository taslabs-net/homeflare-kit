/**
 * Generated proxmox-backup-server API types for `/admin/datastore/store` — DO NOT EDIT BY HAND.
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

/** GET /admin/datastore/{store}/protected — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreProtectedGetParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  ns?: string;
};
/** GET /admin/datastore/{store}/protected — `data` payload after client unwrap. */
export type AdminDatastoreStoreProtectedGetReturn = null;

/** PUT /admin/datastore/{store}/protected — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreProtectedPutParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  ns?: string;
  protected: '0' | '1';
};
/** PUT /admin/datastore/{store}/protected — `data` payload after client unwrap. */
export type AdminDatastoreStoreProtectedPutReturn = null;

/** POST /admin/datastore/{store}/prune — form/query parameters (path segments omitted). */
export type AdminDatastoreStorePrunePostParams = {
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  'dry-run'?: '0' | '1';
  'keep-daily'?: `${number}`;
  'keep-hourly'?: `${number}`;
  'keep-last'?: `${number}`;
  'keep-monthly'?: `${number}`;
  'keep-weekly'?: `${number}`;
  'keep-yearly'?: `${number}`;
  ns?: string;
  'use-task'?: '0' | '1';
};
/** POST /admin/datastore/{store}/prune — `data` payload after client unwrap. */
export type AdminDatastoreStorePrunePostReturn = readonly {
  'backup-id': string;
  'backup-time': number;
  'backup-type': 'vm' | 'ct' | 'host';
  keep: boolean | 0 | 1;
}[];

/** POST /admin/datastore/{store}/prune-datastore — form/query parameters (path segments omitted). */
export type AdminDatastoreStorePruneDatastorePostParams = {
  'dry-run'?: '0' | '1';
  'keep-daily'?: `${number}`;
  'keep-hourly'?: `${number}`;
  'keep-last'?: `${number}`;
  'keep-monthly'?: `${number}`;
  'keep-weekly'?: `${number}`;
  'keep-yearly'?: `${number}`;
  'max-depth'?: `${number}`;
  ns?: string;
};
/** POST /admin/datastore/{store}/prune-datastore — `data` payload after client unwrap. */
export type AdminDatastoreStorePruneDatastorePostReturn = string;

/** GET /admin/datastore/{store}/pxar-file-download — form/query parameters (path segments omitted). */
export type AdminDatastoreStorePxarFileDownloadGetParams = {
  'archive-name'?: string;
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  filepath: string;
  ns?: string;
  tar?: '0' | '1';
};
/** GET /admin/datastore/{store}/pxar-file-download — `data` payload after client unwrap. */
export type AdminDatastoreStorePxarFileDownloadGetReturn = null;

/** GET /admin/datastore/{store}/rrd — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreRrdGetParams = {
  cf: 'MAX' | 'AVERAGE';
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year' | 'decade';
};
/** GET /admin/datastore/{store}/rrd — `data` payload after client unwrap. */
export type AdminDatastoreStoreRrdGetReturn = null;

/** PUT /admin/datastore/{store}/s3-refresh — `data` payload after client unwrap. */
export type AdminDatastoreStoreS3RefreshPutReturn = string;

/** GET /admin/datastore/{store}/snapshots — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreSnapshotsGetParams = {
  'backup-id'?: string;
  'backup-type'?: 'vm' | 'ct' | 'host';
  ns?: string;
};
/** GET /admin/datastore/{store}/snapshots — `data` payload after client unwrap. */
export type AdminDatastoreStoreSnapshotsGetReturn = readonly {
  'backup-id': string;
  'backup-time': number;
  'backup-type': 'vm' | 'ct' | 'host';
  comment?: string;
  files: readonly string[];
  fingerprint?: string;
  owner?: string;
  protected: boolean | 0 | 1;
  size?: number;
  verification?: { state: 'ok' | 'failed'; upid: string };
}[];

/** DELETE /admin/datastore/{store}/snapshots — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreSnapshotsDeleteParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  ns?: string;
};
/** DELETE /admin/datastore/{store}/snapshots — `data` payload after client unwrap. */
export type AdminDatastoreStoreSnapshotsDeleteReturn = null;

/** GET /admin/datastore/{store}/status — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreStatusGetParams = { verbose?: '0' | '1' };
/** GET /admin/datastore/{store}/status — `data` payload after client unwrap. */
export type AdminDatastoreStoreStatusGetReturn = {
  avail: number;
  'backend-type': 'filesystem' | 's3';
  counts?: {
    ct?: { groups: number; snapshots: number };
    host?: { groups: number; snapshots: number };
    other?: { groups: number; snapshots: number };
    vm?: { groups: number; snapshots: number };
  };
  'gc-status'?: {
    'cache-stats'?: { hits: number; misses: number };
    'disk-bytes': number;
    'disk-chunks': number;
    'index-data-bytes': number;
    'index-file-count': number;
    'pending-bytes': number;
    'pending-chunks': number;
    'removed-bad': number;
    'removed-bytes': number;
    'removed-chunks': number;
    'still-bad': number;
    upid?: string;
  };
  's3-statistics'?: {
    delete: number;
    downloaded: number;
    get: number;
    head: number;
    post: number;
    put: number;
    uploaded: number;
  };
  total: number;
  used: number;
};

/** POST /admin/datastore/{store}/unmount — `data` payload after client unwrap. */
export type AdminDatastoreStoreUnmountPostReturn = string;

/** POST /admin/datastore/{store}/upload-backup-log — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreUploadBackupLogPostParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  ns?: string;
};
/** POST /admin/datastore/{store}/upload-backup-log — `data` payload after client unwrap. */
export type AdminDatastoreStoreUploadBackupLogPostReturn = null;

/** POST /admin/datastore/{store}/verify — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreVerifyPostParams = {
  'backup-id'?: string;
  'backup-time'?: `${number}`;
  'backup-type'?: 'vm' | 'ct' | 'host';
  'ignore-verified'?: '0' | '1';
  'max-depth'?: `${number}`;
  ns?: string;
  'outdated-after'?: `${number}`;
  'read-threads'?: `${number}`;
  'verify-threads'?: `${number}`;
};
/** POST /admin/datastore/{store}/verify — `data` payload after client unwrap. */
export type AdminDatastoreStoreVerifyPostReturn = string;

/** GET /admin/gc — form/query parameters (path segments omitted). */
export type AdminGcGetParams = { store?: string };
/** GET /admin/gc — `data` payload after client unwrap. */
export type AdminGcGetReturn = readonly {
  'cache-stats'?: { hits: number; misses: number };
  'disk-bytes': number;
  'disk-chunks': number;
  duration?: number;
  'index-data-bytes': number;
  'index-file-count': number;
  'last-run-endtime'?: number;
  'last-run-state'?: string;
  'next-run'?: number;
  'pending-bytes': number;
  'pending-chunks': number;
  'removed-bad': number;
  'removed-bytes': number;
  'removed-chunks': number;
  schedule?: string;
  'still-bad': number;
  store: string;
  upid?: string;
}[];

/** GET /admin/gc/{store} — `data` payload after client unwrap. */
export type AdminGcStoreGetReturn = readonly {
  'cache-stats'?: { hits: number; misses: number };
  'disk-bytes': number;
  'disk-chunks': number;
  duration?: number;
  'index-data-bytes': number;
  'index-file-count': number;
  'last-run-endtime'?: number;
  'last-run-state'?: string;
  'next-run'?: number;
  'pending-bytes': number;
  'pending-chunks': number;
  'removed-bad': number;
  'removed-bytes': number;
  'removed-chunks': number;
  schedule?: string;
  'still-bad': number;
  store: string;
  upid?: string;
}[];
