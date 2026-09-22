/**
 * Generated proxmox-backup-server API types for `/admin` — DO NOT EDIT BY HAND.
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

/** GET /admin — `data` payload after client unwrap. */
export type AdminGetReturn = null;

/** GET /admin/datastore — `data` payload after client unwrap. */
export type AdminDatastoreGetReturn = readonly {
  'backend-type': 'filesystem' | 's3';
  comment?: string;
  maintenance?: string;
  'mount-status': 'mounted' | 'notmounted' | 'nonremovable';
  store: string;
}[];

/** GET /admin/datastore/{store} — `data` payload after client unwrap. */
export type AdminDatastoreStoreGetReturn = null;

/** GET /admin/datastore/{store}/active-operations — `data` payload after client unwrap. */
export type AdminDatastoreStoreActiveOperationsGetReturn = null;

/** GET /admin/datastore/{store}/catalog — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreCatalogGetParams = {
  'archive-name'?: string;
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  filepath: string;
  ns?: string;
};
/** GET /admin/datastore/{store}/catalog — `data` payload after client unwrap. */
export type AdminDatastoreStoreCatalogGetReturn = null;

/** POST /admin/datastore/{store}/change-owner — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreChangeOwnerPostParams = {
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  'new-owner': string;
  ns?: string;
};
/** POST /admin/datastore/{store}/change-owner — `data` payload after client unwrap. */
export type AdminDatastoreStoreChangeOwnerPostReturn = null;

/** GET /admin/datastore/{store}/download — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreDownloadGetParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  'file-name': string;
  ns?: string;
};
/** GET /admin/datastore/{store}/download — `data` payload after client unwrap. */
export type AdminDatastoreStoreDownloadGetReturn = null;

/** GET /admin/datastore/{store}/download-decoded — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreDownloadDecodedGetParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  'file-name': string;
  ns?: string;
};
/** GET /admin/datastore/{store}/download-decoded — `data` payload after client unwrap. */
export type AdminDatastoreStoreDownloadDecodedGetReturn = null;

/** GET /admin/datastore/{store}/files — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreFilesGetParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  ns?: string;
};
/** GET /admin/datastore/{store}/files — `data` payload after client unwrap. */
export type AdminDatastoreStoreFilesGetReturn = readonly {
  'crypt-mode'?: 'none' | 'encrypt' | 'sign-only';
  filename: string;
  size?: number;
}[];

/** GET /admin/datastore/{store}/gc — `data` payload after client unwrap. */
export type AdminDatastoreStoreGcGetReturn = {
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
};

/** POST /admin/datastore/{store}/gc — `data` payload after client unwrap. */
export type AdminDatastoreStoreGcPostReturn = string;

/** GET /admin/datastore/{store}/group-notes — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreGroupNotesGetParams = {
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  ns?: string;
};
/** GET /admin/datastore/{store}/group-notes — `data` payload after client unwrap. */
export type AdminDatastoreStoreGroupNotesGetReturn = null;

/** PUT /admin/datastore/{store}/group-notes — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreGroupNotesPutParams = {
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  notes: string;
  ns?: string;
};
/** PUT /admin/datastore/{store}/group-notes — `data` payload after client unwrap. */
export type AdminDatastoreStoreGroupNotesPutReturn = null;

/** GET /admin/datastore/{store}/groups — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreGroupsGetParams = { ns?: string };
/** GET /admin/datastore/{store}/groups — `data` payload after client unwrap. */
export type AdminDatastoreStoreGroupsGetReturn = readonly {
  'backup-count': number;
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  comment?: string;
  files: readonly string[];
  'last-backup': number;
  owner?: string;
}[];

/** DELETE /admin/datastore/{store}/groups — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreGroupsDeleteParams = {
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  'error-on-protected'?: '0' | '1';
  ns?: string;
};
/** DELETE /admin/datastore/{store}/groups — `data` payload after client unwrap. */
export type AdminDatastoreStoreGroupsDeleteReturn = {
  'protected-snapshots': number;
  'removed-groups': number;
  'removed-snapshots': number;
};

/** POST /admin/datastore/{store}/mount — `data` payload after client unwrap. */
export type AdminDatastoreStoreMountPostReturn = string;

/** POST /admin/datastore/{store}/move-group — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreMoveGroupPostParams = {
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  'merge-group'?: '0' | '1';
  ns?: string;
  'target-ns'?: string;
};
/** POST /admin/datastore/{store}/move-group — `data` payload after client unwrap. */
export type AdminDatastoreStoreMoveGroupPostReturn = string;

/** POST /admin/datastore/{store}/move-namespace — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreMoveNamespacePostParams = {
  'delete-source'?: '0' | '1';
  'max-depth'?: `${number}`;
  'merge-groups'?: '0' | '1';
  ns: string;
  'target-ns': string;
};
/** POST /admin/datastore/{store}/move-namespace — `data` payload after client unwrap. */
export type AdminDatastoreStoreMoveNamespacePostReturn = string;

/** GET /admin/datastore/{store}/namespace — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreNamespaceGetParams = { 'max-depth'?: `${number}`; parent?: string };
/** GET /admin/datastore/{store}/namespace — `data` payload after client unwrap. */
export type AdminDatastoreStoreNamespaceGetReturn = readonly { comment?: string; ns: string }[];

/** POST /admin/datastore/{store}/namespace — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreNamespacePostParams = { name: string; parent?: string };
/** POST /admin/datastore/{store}/namespace — `data` payload after client unwrap. */
export type AdminDatastoreStoreNamespacePostReturn = string;

/** DELETE /admin/datastore/{store}/namespace — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreNamespaceDeleteParams = {
  'delete-groups'?: '0' | '1';
  'error-on-protected'?: '0' | '1';
  ns: string;
};
/** DELETE /admin/datastore/{store}/namespace — `data` payload after client unwrap. */
export type AdminDatastoreStoreNamespaceDeleteReturn = null;

/** GET /admin/datastore/{store}/notes — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreNotesGetParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  ns?: string;
};
/** GET /admin/datastore/{store}/notes — `data` payload after client unwrap. */
export type AdminDatastoreStoreNotesGetReturn = null;

/** PUT /admin/datastore/{store}/notes — form/query parameters (path segments omitted). */
export type AdminDatastoreStoreNotesPutParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  notes: string;
  ns?: string;
};
/** PUT /admin/datastore/{store}/notes — `data` payload after client unwrap. */
export type AdminDatastoreStoreNotesPutReturn = null;
