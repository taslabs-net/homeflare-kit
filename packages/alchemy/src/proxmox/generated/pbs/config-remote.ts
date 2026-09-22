/**
 * Generated proxmox-backup-server API types for `/config/remote` — DO NOT EDIT BY HAND.
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

/** GET /config/remote — `data` payload after client unwrap. */
export type ConfigRemoteGetReturn = readonly {
  'auth-id': string;
  comment?: string;
  fingerprint?: string;
  host: string;
  name: string;
  port?: number;
  'use-node-proxy'?: boolean | 0 | 1;
}[];

/** POST /config/remote — form/query parameters (path segments omitted). */
export type ConfigRemotePostParams = {
  'auth-id': string;
  comment?: string;
  fingerprint?: string;
  host: string;
  name: string;
  password: string;
  port?: `${number}`;
  'use-node-proxy'?: '0' | '1';
};
/** POST /config/remote — `data` payload after client unwrap. */
export type ConfigRemotePostReturn = null;

/** GET /config/remote/{name} — `data` payload after client unwrap. */
export type ConfigRemoteNameGetReturn = {
  'auth-id': string;
  comment?: string;
  fingerprint?: string;
  host: string;
  name: string;
  port?: number;
  'use-node-proxy'?: boolean | 0 | 1;
};

/** PUT /config/remote/{name} — form/query parameters (path segments omitted). */
export type ConfigRemoteNamePutParams = {
  'auth-id'?: string;
  comment?: string;
  delete?: readonly ('comment' | 'fingerprint' | 'port' | 'use-node-proxy')[];
  digest?: string;
  fingerprint?: string;
  host?: string;
  password?: string;
  port?: `${number}`;
  'use-node-proxy'?: '0' | '1';
};
/** PUT /config/remote/{name} — `data` payload after client unwrap. */
export type ConfigRemoteNamePutReturn = null;

/** DELETE /config/remote/{name} — form/query parameters (path segments omitted). */
export type ConfigRemoteNameDeleteParams = { digest?: string };
/** DELETE /config/remote/{name} — `data` payload after client unwrap. */
export type ConfigRemoteNameDeleteReturn = null;

/** GET /config/remote/{name}/scan — `data` payload after client unwrap. */
export type ConfigRemoteNameScanGetReturn = readonly {
  'backend-type': 'filesystem' | 's3';
  comment?: string;
  maintenance?: string;
  'mount-status': 'mounted' | 'notmounted' | 'nonremovable';
  store: string;
}[];

/** GET /config/remote/{name}/scan/{store} — `data` payload after client unwrap. */
export type ConfigRemoteNameScanStoreGetReturn = null;

/** GET /config/remote/{name}/scan/{store}/groups — form/query parameters (path segments omitted). */
export type ConfigRemoteNameScanStoreGroupsGetParams = { namespace?: string };
/** GET /config/remote/{name}/scan/{store}/groups — `data` payload after client unwrap. */
export type ConfigRemoteNameScanStoreGroupsGetReturn = readonly {
  'backup-count': number;
  'backup-id': string;
  'backup-type': 'vm' | 'ct' | 'host';
  comment?: string;
  files: readonly string[];
  'last-backup': number;
  owner?: string;
}[];

/** GET /config/remote/{name}/scan/{store}/namespaces — `data` payload after client unwrap. */
export type ConfigRemoteNameScanStoreNamespacesGetReturn = readonly {
  comment?: string;
  ns: string;
}[];

/** GET /config/s3 — `data` payload after client unwrap. */
export type ConfigS3GetReturn = readonly {
  'access-key': string;
  'burst-in'?: string;
  'burst-out'?: string;
  endpoint: string;
  fingerprint?: string;
  id: string;
  'path-style'?: boolean | 0 | 1;
  port?: number;
  'provider-quirks'?: readonly ('skip-if-none-match-header' | 'delete-objects-via-delete-object')[];
  'put-rate-limit'?: number;
  'rate-in'?: string;
  'rate-out'?: string;
  region?: string;
}[];

/** POST /config/s3 — form/query parameters (path segments omitted). */
export type ConfigS3PostParams = {
  'access-key': string;
  'burst-in'?: string;
  'burst-out'?: string;
  endpoint: string;
  fingerprint?: string;
  id: string;
  'path-style'?: '0' | '1';
  port?: `${number}`;
  'provider-quirks'?: readonly ('skip-if-none-match-header' | 'delete-objects-via-delete-object')[];
  'put-rate-limit'?: `${number}`;
  'rate-in'?: string;
  'rate-out'?: string;
  region?: string;
  'secret-key': string;
};
/** POST /config/s3 — `data` payload after client unwrap. */
export type ConfigS3PostReturn = null;

/** GET /config/s3/{id} — `data` payload after client unwrap. */
export type ConfigS3IdGetReturn = {
  'access-key': string;
  'burst-in'?: string;
  'burst-out'?: string;
  endpoint: string;
  fingerprint?: string;
  id: string;
  'path-style'?: boolean | 0 | 1;
  port?: number;
  'provider-quirks'?: readonly ('skip-if-none-match-header' | 'delete-objects-via-delete-object')[];
  'put-rate-limit'?: number;
  'rate-in'?: string;
  'rate-out'?: string;
  region?: string;
};

/** PUT /config/s3/{id} — form/query parameters (path segments omitted). */
export type ConfigS3IdPutParams = {
  'access-key'?: string;
  'burst-in'?: string;
  'burst-out'?: string;
  delete?: readonly (
    | 'port'
    | 'region'
    | 'fingerprint'
    | 'path-style'
    | 'rate-in'
    | 'burst-in'
    | 'rate-out'
    | 'burst-out'
    | 'provider-quirks')[];
  digest?: string;
  endpoint?: string;
  fingerprint?: string;
  'path-style'?: '0' | '1';
  port?: `${number}`;
  'provider-quirks'?: readonly ('skip-if-none-match-header' | 'delete-objects-via-delete-object')[];
  'put-rate-limit'?: `${number}`;
  'rate-in'?: string;
  'rate-out'?: string;
  region?: string;
  'secret-key'?: string;
};
/** PUT /config/s3/{id} — `data` payload after client unwrap. */
export type ConfigS3IdPutReturn = null;

/** DELETE /config/s3/{id} — form/query parameters (path segments omitted). */
export type ConfigS3IdDeleteParams = { digest?: string };
/** DELETE /config/s3/{id} — `data` payload after client unwrap. */
export type ConfigS3IdDeleteReturn = null;

/** GET /config/s3/{id}/list-buckets — `data` payload after client unwrap. */
export type ConfigS3IdListBucketsGetReturn = null;
