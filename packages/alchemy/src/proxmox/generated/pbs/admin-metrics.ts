/**
 * Generated proxmox-backup-server API types for `/admin/metrics` — DO NOT EDIT BY HAND.
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

/** GET /admin/metrics — `data` payload after client unwrap. */
export type AdminMetricsGetReturn = readonly {
  comment?: string;
  enable?: boolean | 0 | 1;
  name: string;
  server: string;
  type: 'influxdb-http' | 'influxdb-udp';
}[];

/** GET /admin/prune — form/query parameters (path segments omitted). */
export type AdminPruneGetParams = { store?: string };
/** GET /admin/prune — `data` payload after client unwrap. */
export type AdminPruneGetReturn = readonly {
  comment?: string;
  disable?: boolean | 0 | 1;
  id: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'last-run-endtime'?: number;
  'last-run-state'?: string;
  'last-run-upid'?: string;
  'max-depth'?: number;
  'next-run'?: number;
  ns?: string;
  schedule: string;
  store: string;
}[];

/** GET /admin/prune/{id} — `data` payload after client unwrap. */
export type AdminPruneIdGetReturn = null;

/** POST /admin/prune/{id}/run — `data` payload after client unwrap. */
export type AdminPruneIdRunPostReturn = null;

/** GET /admin/s3/{s3-endpoint-id} — `data` payload after client unwrap. */
export type AdminS3S3EndpointIdGetReturn = null;

/** PUT /admin/s3/{s3-endpoint-id}/check — form/query parameters (path segments omitted). */
export type AdminS3S3EndpointIdCheckPutParams = { bucket: string; 'store-prefix'?: string };
/** PUT /admin/s3/{s3-endpoint-id}/check — `data` payload after client unwrap. */
export type AdminS3S3EndpointIdCheckPutReturn = null;

/** PUT /admin/s3/{s3-endpoint-id}/reset-counters — form/query parameters (path segments omitted). */
export type AdminS3S3EndpointIdResetCountersPutParams = { bucket: string; 'store-prefix'?: string };
/** PUT /admin/s3/{s3-endpoint-id}/reset-counters — `data` payload after client unwrap. */
export type AdminS3S3EndpointIdResetCountersPutReturn = null;

/** GET /admin/sync — form/query parameters (path segments omitted). */
export type AdminSyncGetParams = { store?: string; 'sync-direction'?: 'all' | 'push' | 'pull' };
/** GET /admin/sync — `data` payload after client unwrap. */
export type AdminSyncGetReturn = readonly {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'encrypted-only'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'last-run-endtime'?: number;
  'last-run-state'?: string;
  'last-run-upid'?: string;
  'max-depth'?: number;
  'next-run'?: number;
  ns?: string;
  owner?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store': string;
  'remove-vanished'?: boolean | 0 | 1;
  'resync-corrupt'?: boolean | 0 | 1;
  'run-on-mount'?: boolean | 0 | 1;
  schedule?: string;
  store: string;
  'sync-direction'?: 'pull' | 'push';
  'transfer-last'?: number;
  'unmount-on-done'?: boolean | 0 | 1;
  'verified-only'?: boolean | 0 | 1;
  'worker-threads'?: number;
}[];

/** GET /admin/sync/{id} — `data` payload after client unwrap. */
export type AdminSyncIdGetReturn = null;

/** POST /admin/sync/{id}/run — `data` payload after client unwrap. */
export type AdminSyncIdRunPostReturn = null;

/** GET /admin/traffic-control — `data` payload after client unwrap. */
export type AdminTrafficControlGetReturn = readonly {
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'cur-rate-in': number;
  'cur-rate-out': number;
  name: string;
  network: readonly string[];
  'rate-in'?: string;
  'rate-out'?: string;
  timeframe?: readonly string[];
  users?: readonly string[];
}[];

/** GET /admin/verify — form/query parameters (path segments omitted). */
export type AdminVerifyGetParams = { store?: string };
/** GET /admin/verify — `data` payload after client unwrap. */
export type AdminVerifyGetReturn = readonly {
  comment?: string;
  id: string;
  'ignore-verified'?: boolean | 0 | 1;
  'last-run-endtime'?: number;
  'last-run-state'?: string;
  'last-run-upid'?: string;
  'max-depth'?: number;
  'next-run'?: number;
  ns?: string;
  'outdated-after'?: number;
  'read-threads'?: number;
  schedule?: string;
  store: string;
  'verify-threads'?: number;
}[];

/** GET /admin/verify/{id} — `data` payload after client unwrap. */
export type AdminVerifyIdGetReturn = null;

/** POST /admin/verify/{id}/run — `data` payload after client unwrap. */
export type AdminVerifyIdRunPostReturn = null;
