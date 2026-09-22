/**
 * Generated proxmox-backup-server API types for `/status` — DO NOT EDIT BY HAND.
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

/** GET /status — `data` payload after client unwrap. */
export type StatusGetReturn = null;

/** GET /status/datastore-usage — `data` payload after client unwrap. */
export type StatusDatastoreUsageGetReturn = readonly {
  avail?: number;
  'backend-type': 'filesystem' | 's3';
  error?: string;
  'estimated-full-date'?: number;
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
  history?: readonly number[];
  'history-delta'?: number;
  'history-start'?: number;
  'mount-status': 'mounted' | 'notmounted' | 'nonremovable';
  store: string;
  total?: number;
  used?: number;
}[];

/** GET /status/metrics — form/query parameters (path segments omitted). */
export type StatusMetricsGetParams = { history?: '0' | '1'; 'start-time'?: `${number}` };
/** GET /status/metrics — `data` payload after client unwrap. */
export type StatusMetricsGetReturn = null;
