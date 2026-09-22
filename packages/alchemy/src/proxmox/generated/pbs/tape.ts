/**
 * Generated proxmox-backup-server API types for `/tape` — DO NOT EDIT BY HAND.
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

/** GET /tape — `data` payload after client unwrap. */
export type TapeGetReturn = null;

/** GET /tape/backup — `data` payload after client unwrap. */
export type TapeBackupGetReturn = readonly {
  comment?: string;
  drive: string;
  'eject-media'?: boolean | 0 | 1;
  'export-media-set'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'last-run-endtime'?: number;
  'last-run-state'?: string;
  'last-run-upid'?: string;
  'latest-only'?: boolean | 0 | 1;
  'max-depth'?: number;
  'next-media-label'?: string;
  'next-run'?: number;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notify-user'?: string;
  ns?: string;
  pool: string;
  schedule?: string;
  store: string;
  'worker-threads'?: number;
}[];

/** POST /tape/backup — form/query parameters (path segments omitted). */
export type TapeBackupPostParams = {
  drive: string;
  'eject-media'?: '0' | '1';
  'export-media-set'?: '0' | '1';
  'force-media-set'?: '0' | '1';
  'group-filter'?: readonly string[];
  'latest-only'?: '0' | '1';
  'max-depth'?: `${number}`;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notify-user'?: string;
  ns?: string;
  pool: string;
  store: string;
  'worker-threads'?: `${number}`;
};
/** POST /tape/backup — `data` payload after client unwrap. */
export type TapeBackupPostReturn = string;

/** POST /tape/backup/{id} — `data` payload after client unwrap. */
export type TapeBackupIdPostReturn = null;

/** GET /tape/changer — `data` payload after client unwrap. */
export type TapeChangerGetReturn = readonly {
  'eject-before-unload'?: boolean | 0 | 1;
  'export-slots'?: string;
  model?: string;
  name: string;
  path: string;
  serial?: string;
  vendor?: string;
}[];

/** GET /tape/changer/{name} — `data` payload after client unwrap. */
export type TapeChangerNameGetReturn = null;

/** GET /tape/changer/{name}/status — form/query parameters (path segments omitted). */
export type TapeChangerNameStatusGetParams = { cache?: '0' | '1' };
/** GET /tape/changer/{name}/status — `data` payload after client unwrap. */
export type TapeChangerNameStatusGetReturn = readonly {
  'entry-id': number;
  'entry-kind': 'drive' | 'slot' | 'import-export';
  'label-text'?: string;
  'loaded-slot'?: number;
  state?: string;
}[];

/** POST /tape/changer/{name}/transfer — form/query parameters (path segments omitted). */
export type TapeChangerNameTransferPostParams = { from: `${number}`; to: `${number}` };
/** POST /tape/changer/{name}/transfer — `data` payload after client unwrap. */
export type TapeChangerNameTransferPostReturn = null;
