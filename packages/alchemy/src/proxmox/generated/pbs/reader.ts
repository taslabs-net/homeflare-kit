/**
 * Generated proxmox-backup-server API types for `/reader` — DO NOT EDIT BY HAND.
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

/** GET /reader — form/query parameters (path segments omitted). */
export type ReaderGetParams = {
  'backup-id': string;
  'backup-time': `${number}`;
  'backup-type': 'vm' | 'ct' | 'host';
  debug?: '0' | '1';
  ns?: string;
  store: string;
};
/** GET /reader — `data` payload after client unwrap. */
export type ReaderGetReturn = null;

/** GET /reader/_upgrade_ — `data` payload after client unwrap. */
export type Reader_upgrade_GetReturn = null;

/** GET /reader/_upgrade_/chunk — form/query parameters (path segments omitted). */
export type Reader_upgrade_ChunkGetParams = { digest: string };
/** GET /reader/_upgrade_/chunk — `data` payload after client unwrap. */
export type Reader_upgrade_ChunkGetReturn = null;

/** GET /reader/_upgrade_/download — form/query parameters (path segments omitted). */
export type Reader_upgrade_DownloadGetParams = { 'file-name': string };
/** GET /reader/_upgrade_/download — `data` payload after client unwrap. */
export type Reader_upgrade_DownloadGetReturn = null;

/** GET /reader/_upgrade_/speedtest — `data` payload after client unwrap. */
export type Reader_upgrade_SpeedtestGetReturn = null;
