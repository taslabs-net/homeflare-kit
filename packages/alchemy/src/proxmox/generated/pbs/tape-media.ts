/**
 * Generated proxmox-backup-server API types for `/tape/media` — DO NOT EDIT BY HAND.
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

/** GET /tape/media — `data` payload after client unwrap. */
export type TapeMediaGetReturn = null;

/** GET /tape/media/content — form/query parameters (path segments omitted). */
export type TapeMediaContentGetParams = {
  'backup-id'?: string;
  'backup-type'?: 'vm' | 'ct' | 'host';
  'label-text'?: string;
  media?: string;
  'media-set'?: string;
  pool?: string;
};
/** GET /tape/media/content — `data` payload after client unwrap. */
export type TapeMediaContentGetReturn = readonly {
  'backup-time': number;
  'label-text': string;
  'media-set-ctime': number;
  'media-set-name': string;
  'media-set-uuid': string;
  pool: string;
  'seq-nr': number;
  snapshot: string;
  store: string;
  uuid: string;
}[];

/** GET /tape/media/destroy — form/query parameters (path segments omitted). */
export type TapeMediaDestroyGetParams = { force?: '0' | '1'; 'label-text'?: string; uuid?: string };
/** GET /tape/media/destroy — `data` payload after client unwrap. */
export type TapeMediaDestroyGetReturn = null;

/** GET /tape/media/list — form/query parameters (path segments omitted). */
export type TapeMediaListGetParams = {
  pool?: string;
  'update-status'?: '0' | '1';
  'update-status-changer'?: string;
};
/** GET /tape/media/list — `data` payload after client unwrap. */
export type TapeMediaListGetReturn = readonly {
  'bytes-used'?: number;
  catalog: boolean | 0 | 1;
  ctime: number;
  expired: boolean | 0 | 1;
  'label-text': string;
  location: string;
  'media-set-ctime'?: number;
  'media-set-name'?: string;
  'media-set-uuid'?: string;
  pool?: string;
  'seq-nr'?: number;
  status: 'writable' | 'full' | 'unknown' | 'damaged' | 'retired';
  uuid: string;
}[];

/** GET /tape/media/list/{uuid} — `data` payload after client unwrap. */
export type TapeMediaListUuidGetReturn = null;

/** GET /tape/media/list/{uuid}/status — `data` payload after client unwrap. */
export type TapeMediaListUuidStatusGetReturn = null;

/** POST /tape/media/list/{uuid}/status — form/query parameters (path segments omitted). */
export type TapeMediaListUuidStatusPostParams = {
  status?: 'writable' | 'full' | 'unknown' | 'damaged' | 'retired';
};
/** POST /tape/media/list/{uuid}/status — `data` payload after client unwrap. */
export type TapeMediaListUuidStatusPostReturn = null;

/** GET /tape/media/media-sets — `data` payload after client unwrap. */
export type TapeMediaMediaSetsGetReturn = readonly {
  'media-set-ctime': number;
  'media-set-name': string;
  'media-set-uuid': string;
  pool: string;
}[];

/** POST /tape/media/move — form/query parameters (path segments omitted). */
export type TapeMediaMovePostParams = {
  'label-text'?: string;
  uuid?: string;
  'vault-name'?: string;
};
/** POST /tape/media/move — `data` payload after client unwrap. */
export type TapeMediaMovePostReturn = null;

/** POST /tape/restore — form/query parameters (path segments omitted). */
export type TapeRestorePostParams = {
  drive: string;
  'media-set': string;
  namespaces?: readonly string[];
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notify-user'?: string;
  owner?: string;
  snapshots?: readonly string[];
  store: string;
};
/** POST /tape/restore — `data` payload after client unwrap. */
export type TapeRestorePostReturn = string;

/** GET /tape/scan-changers — `data` payload after client unwrap. */
export type TapeScanChangersGetReturn = readonly {
  kind: 'changer' | 'tape';
  major: number;
  minor: number;
  model: string;
  path: string;
  serial: string;
  vendor: string;
}[];

/** GET /tape/scan-drives — `data` payload after client unwrap. */
export type TapeScanDrivesGetReturn = readonly {
  kind: 'changer' | 'tape';
  major: number;
  minor: number;
  model: string;
  path: string;
  serial: string;
  vendor: string;
}[];
