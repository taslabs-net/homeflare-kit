/**
 * Generated proxmox-backup-server API types for `/config/verify` — DO NOT EDIT BY HAND.
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

/** GET /config/verify — `data` payload after client unwrap. */
export type ConfigVerifyGetReturn = readonly {
  comment?: string;
  id: string;
  'ignore-verified'?: boolean | 0 | 1;
  'max-depth'?: number;
  ns?: string;
  'outdated-after'?: number;
  'read-threads'?: number;
  schedule?: string;
  store: string;
  'verify-threads'?: number;
}[];

/** POST /config/verify — form/query parameters (path segments omitted). */
export type ConfigVerifyPostParams = {
  comment?: string;
  id: string;
  'ignore-verified'?: '0' | '1';
  'max-depth'?: `${number}`;
  ns?: string;
  'outdated-after'?: `${number}`;
  'read-threads'?: `${number}`;
  schedule?: string;
  store: string;
  'verify-threads'?: `${number}`;
};
/** POST /config/verify — `data` payload after client unwrap. */
export type ConfigVerifyPostReturn = null;

/** GET /config/verify/{id} — `data` payload after client unwrap. */
export type ConfigVerifyIdGetReturn = {
  comment?: string;
  id: string;
  'ignore-verified'?: boolean | 0 | 1;
  'max-depth'?: number;
  ns?: string;
  'outdated-after'?: number;
  'read-threads'?: number;
  schedule?: string;
  store: string;
  'verify-threads'?: number;
};

/** PUT /config/verify/{id} — form/query parameters (path segments omitted). */
export type ConfigVerifyIdPutParams = {
  comment?: string;
  delete?: readonly (
    | 'ignore-verified'
    | 'comment'
    | 'schedule'
    | 'outdated-after'
    | 'ns'
    | 'max-depth'
    | 'read-threads'
    | 'verify-threads')[];
  digest?: string;
  'ignore-verified'?: '0' | '1';
  'max-depth'?: `${number}`;
  ns?: string;
  'outdated-after'?: `${number}`;
  'read-threads'?: `${number}`;
  schedule?: string;
  store?: string;
  'verify-threads'?: `${number}`;
};
/** PUT /config/verify/{id} — `data` payload after client unwrap. */
export type ConfigVerifyIdPutReturn = null;

/** DELETE /config/verify/{id} — form/query parameters (path segments omitted). */
export type ConfigVerifyIdDeleteParams = { digest?: string };
/** DELETE /config/verify/{id} — `data` payload after client unwrap. */
export type ConfigVerifyIdDeleteReturn = null;
