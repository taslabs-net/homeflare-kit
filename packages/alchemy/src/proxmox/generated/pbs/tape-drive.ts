/**
 * Generated proxmox-backup-server API types for `/tape/drive` — DO NOT EDIT BY HAND.
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

/** GET /tape/drive — form/query parameters (path segments omitted). */
export type TapeDriveGetParams = { changer?: string; 'query-activity'?: '0' | '1' };
/** GET /tape/drive — `data` payload after client unwrap. */
export type TapeDriveGetReturn = readonly {
  activity?:
    | 'no-activity'
    | 'cleaning'
    | 'loading'
    | 'unloading'
    | 'other'
    | 'reading'
    | 'writing'
    | 'locating'
    | 'rewinding'
    | 'erasing'
    | 'formatting'
    | 'calibrating'
    | 'other-d-t'
    | 'microcode-update'
    | 'reading-encrypted'
    | 'writing-encrypted';
  changer?: string;
  'changer-drivenum'?: number;
  model?: string;
  name: string;
  path: string;
  serial?: string;
  state?: string;
  vendor?: string;
}[];

/** GET /tape/drive/{drive} — `data` payload after client unwrap. */
export type TapeDriveDriveGetReturn = null;

/** POST /tape/drive/{drive}/barcode-label-media — form/query parameters (path segments omitted). */
export type TapeDriveDriveBarcodeLabelMediaPostParams = { pool?: string };
/** POST /tape/drive/{drive}/barcode-label-media — `data` payload after client unwrap. */
export type TapeDriveDriveBarcodeLabelMediaPostReturn = string;

/** GET /tape/drive/{drive}/cartridge-memory — `data` payload after client unwrap. */
export type TapeDriveDriveCartridgeMemoryGetReturn = readonly {
  id: number;
  name: string;
  value: string;
}[];

/** POST /tape/drive/{drive}/catalog — form/query parameters (path segments omitted). */
export type TapeDriveDriveCatalogPostParams = {
  force?: '0' | '1';
  scan?: '0' | '1';
  verbose?: '0' | '1';
};
/** POST /tape/drive/{drive}/catalog — `data` payload after client unwrap. */
export type TapeDriveDriveCatalogPostReturn = string;

/** PUT /tape/drive/{drive}/clean — `data` payload after client unwrap. */
export type TapeDriveDriveCleanPutReturn = string;

/** POST /tape/drive/{drive}/eject-media — `data` payload after client unwrap. */
export type TapeDriveDriveEjectMediaPostReturn = string;

/** PUT /tape/drive/{drive}/export-media — form/query parameters (path segments omitted). */
export type TapeDriveDriveExportMediaPutParams = { 'label-text': string };
/** PUT /tape/drive/{drive}/export-media — `data` payload after client unwrap. */
export type TapeDriveDriveExportMediaPutReturn = number;

/** POST /tape/drive/{drive}/format-media — form/query parameters (path segments omitted). */
export type TapeDriveDriveFormatMediaPostParams = {
  fast?: '0' | '1';
  'label-text'?: string;
  'load-barcode'?: string;
};
/** POST /tape/drive/{drive}/format-media — `data` payload after client unwrap. */
export type TapeDriveDriveFormatMediaPostReturn = string;

/** GET /tape/drive/{drive}/inventory — `data` payload after client unwrap. */
export type TapeDriveDriveInventoryGetReturn = readonly { 'label-text': string; uuid?: string }[];

/** PUT /tape/drive/{drive}/inventory — form/query parameters (path segments omitted). */
export type TapeDriveDriveInventoryPutParams = {
  catalog?: '0' | '1';
  'read-all-labels'?: '0' | '1';
};
/** PUT /tape/drive/{drive}/inventory — `data` payload after client unwrap. */
export type TapeDriveDriveInventoryPutReturn = string;

/** POST /tape/drive/{drive}/label-media — form/query parameters (path segments omitted). */
export type TapeDriveDriveLabelMediaPostParams = { 'label-text': string; pool?: string };
/** POST /tape/drive/{drive}/label-media — `data` payload after client unwrap. */
export type TapeDriveDriveLabelMediaPostReturn = string;

/** POST /tape/drive/{drive}/load-media — form/query parameters (path segments omitted). */
export type TapeDriveDriveLoadMediaPostParams = { 'label-text': string };
/** POST /tape/drive/{drive}/load-media — `data` payload after client unwrap. */
export type TapeDriveDriveLoadMediaPostReturn = string;

/** POST /tape/drive/{drive}/load-slot — form/query parameters (path segments omitted). */
export type TapeDriveDriveLoadSlotPostParams = { 'source-slot': `${number}` };
/** POST /tape/drive/{drive}/load-slot — `data` payload after client unwrap. */
export type TapeDriveDriveLoadSlotPostReturn = null;

/** GET /tape/drive/{drive}/read-label — form/query parameters (path segments omitted). */
export type TapeDriveDriveReadLabelGetParams = { inventorize?: '0' | '1' };
/** GET /tape/drive/{drive}/read-label — `data` payload after client unwrap. */
export type TapeDriveDriveReadLabelGetReturn = {
  ctime: number;
  'encryption-key-fingerprint'?: string;
  'label-text': string;
  'media-set-ctime'?: number;
  'media-set-uuid'?: string;
  pool?: string;
  'seq-nr'?: number;
  uuid: string;
};

/** POST /tape/drive/{drive}/restore-key — form/query parameters (path segments omitted). */
export type TapeDriveDriveRestoreKeyPostParams = { password: string };
/** POST /tape/drive/{drive}/restore-key — `data` payload after client unwrap. */
export type TapeDriveDriveRestoreKeyPostReturn = null;

/** POST /tape/drive/{drive}/rewind — `data` payload after client unwrap. */
export type TapeDriveDriveRewindPostReturn = string;

/** GET /tape/drive/{drive}/status — `data` payload after client unwrap. */
export type TapeDriveDriveStatusGetReturn = {
  'alert-flags'?: string;
  'block-number'?: number;
  blocksize: number;
  'buffer-mode': number;
  'bytes-read'?: number;
  'bytes-written'?: number;
  compression: boolean | 0 | 1;
  density?:
    | 'Unknown'
    | 'LTO1'
    | 'LTO2'
    | 'LTO3'
    | 'LTO4'
    | 'LTO5'
    | 'LTO6'
    | 'LTO7'
    | 'LTO7M8'
    | 'LTO8'
    | 'LTO9';
  'drive-activity'?:
    | 'no-activity'
    | 'cleaning'
    | 'loading'
    | 'unloading'
    | 'other'
    | 'reading'
    | 'writing'
    | 'locating'
    | 'rewinding'
    | 'erasing'
    | 'formatting'
    | 'calibrating'
    | 'other-d-t'
    | 'microcode-update'
    | 'reading-encrypted'
    | 'writing-encrypted';
  'file-number'?: number;
  manufactured?: number;
  'medium-passes'?: number;
  'medium-wearout'?: number;
  product: string;
  revision: string;
  vendor: string;
  'volume-mounts'?: number;
  'write-protect'?: boolean | 0 | 1;
};

/** POST /tape/drive/{drive}/unload — form/query parameters (path segments omitted). */
export type TapeDriveDriveUnloadPostParams = { 'target-slot'?: `${number}` };
/** POST /tape/drive/{drive}/unload — `data` payload after client unwrap. */
export type TapeDriveDriveUnloadPostReturn = string;

/** GET /tape/drive/{drive}/volume-statistics — `data` payload after client unwrap. */
export type TapeDriveDriveVolumeStatisticsGetReturn = {
  'beginning-of-medium-passes': number;
  'last-load-read-compression-ratio': number;
  'last-load-write-compression-ratio': number;
  'last-mount-bytes-read': number;
  'last-mount-bytes-written': number;
  'last-mount-unrecovered-read-errors': number;
  'last-mount-unrecovered-write-errors': number;
  'lifetime-bytes-read': number;
  'lifetime-bytes-written': number;
  'medium-mount-time': number;
  'medium-ready-time': number;
  'middle-of-tape-passes': number;
  serial: string;
  'total-native-capacity': number;
  'total-used-native-capacity': number;
  'volume-datasets-read': number;
  'volume-datasets-written': number;
  'volume-mounts': number;
  'volume-recovered-read-errors': number;
  'volume-recovered-write-data-errors': number;
  'volume-unrecovered-read-errors': number;
  'volume-unrecovered-write-data-errors': number;
  'volume-unrecovered-write-servo-errors': number;
  'volume-write-servo-errors': number;
  worm: boolean | 0 | 1;
  'write-protect': boolean | 0 | 1;
};
