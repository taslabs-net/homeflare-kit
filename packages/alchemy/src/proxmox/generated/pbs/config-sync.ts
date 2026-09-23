/**
 * Generated proxmox-backup-server API types for `/config/sync` — DO NOT EDIT BY HAND.
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

/** GET /config/sync — form/query parameters (path segments omitted). */
export type ConfigSyncGetParams = { 'sync-direction'?: 'all' | 'push' | 'pull' };
/** GET /config/sync — `data` payload after client unwrap. */
export type ConfigSyncGetReturn = readonly {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'encrypted-only'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'max-depth'?: number;
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

/** POST /config/sync — form/query parameters (path segments omitted). */
export type ConfigSyncPostParams = {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'encrypted-only'?: '0' | '1';
  'group-filter'?: readonly string[];
  id: string;
  'max-depth'?: `${number}`;
  ns?: string;
  owner?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store': string;
  'remove-vanished'?: '0' | '1';
  'resync-corrupt'?: '0' | '1';
  'run-on-mount'?: '0' | '1';
  schedule?: string;
  store: string;
  'sync-direction'?: 'pull' | 'push';
  'transfer-last'?: `${number}`;
  'unmount-on-done'?: '0' | '1';
  'verified-only'?: '0' | '1';
  'worker-threads'?: `${number}`;
};
/** POST /config/sync — `data` payload after client unwrap. */
export type ConfigSyncPostReturn = null;

/** GET /config/sync/{id} — `data` payload after client unwrap. */
export type ConfigSyncIdGetReturn = {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  'encrypted-only'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'max-depth'?: number;
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
};

/** PUT /config/sync/{id} — form/query parameters (path segments omitted). */
export type ConfigSyncIdPutParams = {
  'active-encryption-key'?: string;
  'associated-key'?: readonly string[];
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  delete?: readonly (
    | 'remote'
    | 'owner'
    | 'comment'
    | 'schedule'
    | 'remove-vanished'
    | 'group-filter'
    | 'rate-in'
    | 'burst-in'
    | 'rate-out'
    | 'burst-out'
    | 'ns'
    | 'remote-ns'
    | 'max-depth'
    | 'transfer-last'
    | 'encrypted-only'
    | 'verified-only'
    | 'run-on-mount'
    | 'unmount-on-done'
    | 'sync-direction'
    | 'worker-threads'
    | 'active-encryption-key'
    | 'associated-key')[];
  digest?: string;
  'encrypted-only'?: '0' | '1';
  'group-filter'?: readonly string[];
  'max-depth'?: `${number}`;
  ns?: string;
  owner?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store'?: string;
  'remove-vanished'?: '0' | '1';
  'resync-corrupt'?: '0' | '1';
  'run-on-mount'?: '0' | '1';
  schedule?: string;
  store?: string;
  'sync-direction'?: 'pull' | 'push';
  'transfer-last'?: `${number}`;
  'unmount-on-done'?: '0' | '1';
  'verified-only'?: '0' | '1';
  'worker-threads'?: `${number}`;
};
/** PUT /config/sync/{id} — `data` payload after client unwrap. */
export type ConfigSyncIdPutReturn = null;

/** DELETE /config/sync/{id} — form/query parameters (path segments omitted). */
export type ConfigSyncIdDeleteParams = { digest?: string };
/** DELETE /config/sync/{id} — `data` payload after client unwrap. */
export type ConfigSyncIdDeleteReturn = null;
