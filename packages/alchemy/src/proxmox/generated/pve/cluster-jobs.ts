/**
 * Generated pve-manager API types for `/cluster/jobs` — DO NOT EDIT BY HAND.
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

/** GET /cluster/jobs — `data` payload after client unwrap. */
export type ClusterJobsGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /cluster/jobs/realm-sync — `data` payload after client unwrap. */
export type ClusterJobsRealmSyncGetReturn = readonly ({
  comment?: string;
  enabled: boolean | 0 | 1;
  id: string;
  'last-run'?: number;
  'next-run'?: number;
  realm: string;
  'remove-vanished': string;
  schedule: string;
  scope: 'users' | 'groups' | 'both';
} & Record<string, unknown>)[];

/** GET /cluster/jobs/realm-sync/{id} — `data` payload after client unwrap. */
export type ClusterJobsRealmSyncIdGetReturn = unknown;

/** POST /cluster/jobs/realm-sync/{id} — form/query parameters (path segments omitted). */
export type ClusterJobsRealmSyncIdPostParams = {
  comment?: string;
  'enable-new'?: '0' | '1';
  enabled?: '0' | '1';
  realm?: string;
  'remove-vanished'?: string;
  schedule: string;
  scope?: 'users' | 'groups' | 'both';
};
/** POST /cluster/jobs/realm-sync/{id} — `data` payload after client unwrap. */
export type ClusterJobsRealmSyncIdPostReturn = null;

/** PUT /cluster/jobs/realm-sync/{id} — form/query parameters (path segments omitted). */
export type ClusterJobsRealmSyncIdPutParams = {
  comment?: string;
  delete?: string;
  'enable-new'?: '0' | '1';
  enabled?: '0' | '1';
  'remove-vanished'?: string;
  schedule: string;
  scope?: 'users' | 'groups' | 'both';
};
/** PUT /cluster/jobs/realm-sync/{id} — `data` payload after client unwrap. */
export type ClusterJobsRealmSyncIdPutReturn = null;

/** DELETE /cluster/jobs/realm-sync/{id} — `data` payload after client unwrap. */
export type ClusterJobsRealmSyncIdDeleteReturn = null;

/** GET /cluster/jobs/schedule-analyze — form/query parameters (path segments omitted). */
export type ClusterJobsScheduleAnalyzeGetParams = {
  iterations?: `${number}`;
  schedule: string;
  starttime?: `${number}`;
};
/** GET /cluster/jobs/schedule-analyze — `data` payload after client unwrap. */
export type ClusterJobsScheduleAnalyzeGetReturn = readonly ({
  timestamp: number;
  utc: string;
} & Record<string, unknown>)[];

/** GET /cluster/log — form/query parameters (path segments omitted). */
export type ClusterLogGetParams = { max?: `${number}` };
/** GET /cluster/log — `data` payload after client unwrap. */
export type ClusterLogGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/mapping — `data` payload after client unwrap. */
export type ClusterMappingGetReturn = readonly unknown[];

/** GET /cluster/mapping/dir — form/query parameters (path segments omitted). */
export type ClusterMappingDirGetParams = { 'check-node'?: string };
/** GET /cluster/mapping/dir — `data` payload after client unwrap. */
export type ClusterMappingDirGetReturn = readonly ({
  checks?: readonly ({ message: string; severity: 'warning' | 'error' } & Record<string, unknown>)[];
  description: string;
  id: string;
  map: readonly string[];
} & Record<string, unknown>)[];

/** POST /cluster/mapping/dir — form/query parameters (path segments omitted). */
export type ClusterMappingDirPostParams = {
  description?: string;
  id: string;
  map: readonly string[];
};
/** POST /cluster/mapping/dir — `data` payload after client unwrap. */
export type ClusterMappingDirPostReturn = null;

/** GET /cluster/mapping/dir/{id} — `data` payload after client unwrap. */
export type ClusterMappingDirIdGetReturn = unknown;

/** PUT /cluster/mapping/dir/{id} — form/query parameters (path segments omitted). */
export type ClusterMappingDirIdPutParams = {
  delete?: string;
  description?: string;
  digest?: string;
  map?: readonly string[];
};
/** PUT /cluster/mapping/dir/{id} — `data` payload after client unwrap. */
export type ClusterMappingDirIdPutReturn = null;

/** DELETE /cluster/mapping/dir/{id} — `data` payload after client unwrap. */
export type ClusterMappingDirIdDeleteReturn = null;

/** GET /cluster/mapping/pci — form/query parameters (path segments omitted). */
export type ClusterMappingPciGetParams = { 'check-node'?: string };
/** GET /cluster/mapping/pci — `data` payload after client unwrap. */
export type ClusterMappingPciGetReturn = readonly ({
  checks?: readonly ({ message: string; severity: 'warning' | 'error' } & Record<string, unknown>)[];
  description: string;
  id: string;
  map: readonly string[];
} & Record<string, unknown>)[];

/** POST /cluster/mapping/pci — form/query parameters (path segments omitted). */
export type ClusterMappingPciPostParams = {
  description?: string;
  id: string;
  'live-migration-capable'?: '0' | '1';
  map: readonly string[];
  mdev?: '0' | '1';
};
/** POST /cluster/mapping/pci — `data` payload after client unwrap. */
export type ClusterMappingPciPostReturn = null;

/** GET /cluster/mapping/pci/{id} — `data` payload after client unwrap. */
export type ClusterMappingPciIdGetReturn = unknown;

/** PUT /cluster/mapping/pci/{id} — form/query parameters (path segments omitted). */
export type ClusterMappingPciIdPutParams = {
  delete?: string;
  description?: string;
  digest?: string;
  'live-migration-capable'?: '0' | '1';
  map?: readonly string[];
  mdev?: '0' | '1';
};
/** PUT /cluster/mapping/pci/{id} — `data` payload after client unwrap. */
export type ClusterMappingPciIdPutReturn = null;

/** DELETE /cluster/mapping/pci/{id} — `data` payload after client unwrap. */
export type ClusterMappingPciIdDeleteReturn = null;

/** GET /cluster/mapping/usb — form/query parameters (path segments omitted). */
export type ClusterMappingUsbGetParams = { 'check-node'?: string };
/** GET /cluster/mapping/usb — `data` payload after client unwrap. */
export type ClusterMappingUsbGetReturn = readonly ({
  description: string;
  error: unknown;
  id: string;
  map: readonly string[];
} & Record<string, unknown>)[];

/** POST /cluster/mapping/usb — form/query parameters (path segments omitted). */
export type ClusterMappingUsbPostParams = {
  description?: string;
  id: string;
  map: readonly string[];
};
/** POST /cluster/mapping/usb — `data` payload after client unwrap. */
export type ClusterMappingUsbPostReturn = null;

/** GET /cluster/mapping/usb/{id} — `data` payload after client unwrap. */
export type ClusterMappingUsbIdGetReturn = unknown;

/** PUT /cluster/mapping/usb/{id} — form/query parameters (path segments omitted). */
export type ClusterMappingUsbIdPutParams = {
  delete?: string;
  description?: string;
  digest?: string;
  map: readonly string[];
};
/** PUT /cluster/mapping/usb/{id} — `data` payload after client unwrap. */
export type ClusterMappingUsbIdPutReturn = null;

/** DELETE /cluster/mapping/usb/{id} — `data` payload after client unwrap. */
export type ClusterMappingUsbIdDeleteReturn = null;
