/**
 * Generated proxmox-backup-server API types for `/backup` — DO NOT EDIT BY HAND.
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

/** GET /backup — form/query parameters (path segments omitted). */
export type BackupGetParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  benchmark?: '0' | '1';
  debug?: '0' | '1';
  'no-cache'?: '0' | '1';
  ns?: string;
  store: string;
};
/** GET /backup — `data` payload after client unwrap. */
export type BackupGetReturn = null;

/** GET /backup/_upgrade_ — `data` payload after client unwrap. */
export type Backup_upgrade_GetReturn = null;

/** POST /backup/_upgrade_/blob — form/query parameters (path segments omitted). */
export type Backup_upgrade_BlobPostParams = { 'encoded-size': `${number}`; 'file-name': string };
/** POST /backup/_upgrade_/blob — `data` payload after client unwrap. */
export type Backup_upgrade_BlobPostReturn = null;

/** POST /backup/_upgrade_/dynamic_chunk — form/query parameters (path segments omitted). */
export type Backup_upgrade_Dynamic_chunkPostParams = {
  digest: string;
  'encoded-size': `${number}`;
  size: `${number}`;
  wid: `${number}`;
};
/** POST /backup/_upgrade_/dynamic_chunk — `data` payload after client unwrap. */
export type Backup_upgrade_Dynamic_chunkPostReturn = null;

/** POST /backup/_upgrade_/dynamic_close — form/query parameters (path segments omitted). */
export type Backup_upgrade_Dynamic_closePostParams = {
  'chunk-count': `${number}`;
  csum: string;
  size: `${number}`;
  wid: `${number}`;
};
/** POST /backup/_upgrade_/dynamic_close — `data` payload after client unwrap. */
export type Backup_upgrade_Dynamic_closePostReturn = null;

/** POST /backup/_upgrade_/dynamic_index — form/query parameters (path segments omitted). */
export type Backup_upgrade_Dynamic_indexPostParams = { 'archive-name': string };
/** POST /backup/_upgrade_/dynamic_index — `data` payload after client unwrap. */
export type Backup_upgrade_Dynamic_indexPostReturn = null;

/** PUT /backup/_upgrade_/dynamic_index — form/query parameters (path segments omitted). */
export type Backup_upgrade_Dynamic_indexPutParams = {
  'digest-list': readonly string[];
  'offset-list': readonly `${number}`[];
  wid: `${number}`;
};
/** PUT /backup/_upgrade_/dynamic_index — `data` payload after client unwrap. */
export type Backup_upgrade_Dynamic_indexPutReturn = null;

/** POST /backup/_upgrade_/finish — `data` payload after client unwrap. */
export type Backup_upgrade_FinishPostReturn = null;

/** POST /backup/_upgrade_/fixed_chunk — form/query parameters (path segments omitted). */
export type Backup_upgrade_Fixed_chunkPostParams = {
  digest: string;
  'encoded-size': `${number}`;
  size: `${number}`;
  wid: `${number}`;
};
/** POST /backup/_upgrade_/fixed_chunk — `data` payload after client unwrap. */
export type Backup_upgrade_Fixed_chunkPostReturn = null;

/** POST /backup/_upgrade_/fixed_close — form/query parameters (path segments omitted). */
export type Backup_upgrade_Fixed_closePostParams = {
  'chunk-count': `${number}`;
  csum: string;
  size: `${number}`;
  wid: `${number}`;
};
/** POST /backup/_upgrade_/fixed_close — `data` payload after client unwrap. */
export type Backup_upgrade_Fixed_closePostReturn = null;

/** POST /backup/_upgrade_/fixed_index — form/query parameters (path segments omitted). */
export type Backup_upgrade_Fixed_indexPostParams = {
  'archive-name': string;
  'reuse-csum'?: string;
  size?: `${number}`;
};
/** POST /backup/_upgrade_/fixed_index — `data` payload after client unwrap. */
export type Backup_upgrade_Fixed_indexPostReturn = null;

/** PUT /backup/_upgrade_/fixed_index — form/query parameters (path segments omitted). */
export type Backup_upgrade_Fixed_indexPutParams = {
  'digest-list': readonly string[];
  'offset-list': readonly `${number}`[];
  wid: `${number}`;
};
/** PUT /backup/_upgrade_/fixed_index — `data` payload after client unwrap. */
export type Backup_upgrade_Fixed_indexPutReturn = null;

/** GET /backup/_upgrade_/previous — form/query parameters (path segments omitted). */
export type Backup_upgrade_PreviousGetParams = { 'archive-name': string };
/** GET /backup/_upgrade_/previous — `data` payload after client unwrap. */
export type Backup_upgrade_PreviousGetReturn = null;

/** GET /backup/_upgrade_/previous_backup_time — `data` payload after client unwrap. */
export type Backup_upgrade_Previous_backup_timeGetReturn = null;

/** POST /backup/_upgrade_/speedtest — `data` payload after client unwrap. */
export type Backup_upgrade_SpeedtestPostReturn = null;
