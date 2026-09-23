/**
 * Generated proxmox-backup-server API types for `/config/datastore` — DO NOT EDIT BY HAND.
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

/** GET /config/datastore — `data` payload after client unwrap. */
export type ConfigDatastoreGetReturn = readonly {
  backend?: string;
  'backing-device'?: string;
  comment?: string;
  'counter-reset-schedule'?: string;
  'gc-on-unmount'?: boolean | 0 | 1;
  'gc-schedule'?: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'maintenance-mode'?: string;
  name: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  path: string;
  'prune-schedule'?: string;
  tuning?: string;
  'verify-new'?: boolean | 0 | 1;
}[];

/** POST /config/datastore — form/query parameters (path segments omitted). */
export type ConfigDatastorePostParams = {
  backend?: string;
  'backing-device'?: string;
  comment?: string;
  'counter-reset-schedule'?: string;
  'gc-on-unmount'?: '0' | '1';
  'gc-schedule'?: string;
  'keep-daily'?: `${number}`;
  'keep-hourly'?: `${number}`;
  'keep-last'?: `${number}`;
  'keep-monthly'?: `${number}`;
  'keep-weekly'?: `${number}`;
  'keep-yearly'?: `${number}`;
  'maintenance-mode'?: string;
  name: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  'overwrite-in-use'?: '0' | '1';
  path: string;
  'prune-schedule'?: string;
  'reuse-datastore'?: '0' | '1';
  tuning?: string;
  'verify-new'?: '0' | '1';
};
/** POST /config/datastore — `data` payload after client unwrap. */
export type ConfigDatastorePostReturn = null;

/** GET /config/datastore/{name} — `data` payload after client unwrap. */
export type ConfigDatastoreNameGetReturn = {
  backend?: string;
  'backing-device'?: string;
  comment?: string;
  'counter-reset-schedule'?: string;
  'gc-on-unmount'?: boolean | 0 | 1;
  'gc-schedule'?: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'maintenance-mode'?: string;
  name: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  path: string;
  'prune-schedule'?: string;
  tuning?: string;
  'verify-new'?: boolean | 0 | 1;
};

/** PUT /config/datastore/{name} — form/query parameters (path segments omitted). */
export type ConfigDatastoreNamePutParams = {
  comment?: string;
  'counter-reset-schedule'?: string;
  delete?: readonly (
    | 'comment'
    | 'gc-schedule'
    | 'gc-on-unmount'
    | 'prune-schedule'
    | 'keep-last'
    | 'keep-hourly'
    | 'keep-daily'
    | 'keep-weekly'
    | 'keep-monthly'
    | 'keep-yearly'
    | 'verify-new'
    | 'notify-user'
    | 'notify'
    | 'notification-mode'
    | 'tuning'
    | 'maintenance-mode'
    | 'notification-thresholds'
    | 'counter-reset-schedule')[];
  digest?: string;
  'gc-on-unmount'?: '0' | '1';
  'gc-schedule'?: string;
  'keep-daily'?: `${number}`;
  'keep-hourly'?: `${number}`;
  'keep-last'?: `${number}`;
  'keep-monthly'?: `${number}`;
  'keep-weekly'?: `${number}`;
  'keep-yearly'?: `${number}`;
  'maintenance-mode'?: string;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notification-thresholds'?: string;
  notify?: string;
  'notify-user'?: string;
  'prune-schedule'?: string;
  tuning?: string;
  'verify-new'?: '0' | '1';
};
/** PUT /config/datastore/{name} — `data` payload after client unwrap. */
export type ConfigDatastoreNamePutReturn = null;

/** DELETE /config/datastore/{name} — form/query parameters (path segments omitted). */
export type ConfigDatastoreNameDeleteParams = {
  'destroy-data'?: '0' | '1';
  digest?: string;
  'keep-job-configs'?: '0' | '1';
};
/** DELETE /config/datastore/{name} — `data` payload after client unwrap. */
export type ConfigDatastoreNameDeleteReturn = string;

/** GET /config/drive — `data` payload after client unwrap. */
export type ConfigDriveGetReturn = readonly {
  changer?: string;
  'changer-drivenum'?: number;
  name: string;
  path: string;
}[];

/** POST /config/drive — form/query parameters (path segments omitted). */
export type ConfigDrivePostParams = {
  changer?: string;
  'changer-drivenum'?: `${number}`;
  name: string;
  path: string;
};
/** POST /config/drive — `data` payload after client unwrap. */
export type ConfigDrivePostReturn = null;

/** GET /config/drive/{name} — `data` payload after client unwrap. */
export type ConfigDriveNameGetReturn = {
  changer?: string;
  'changer-drivenum'?: number;
  name: string;
  path: string;
};

/** PUT /config/drive/{name} — form/query parameters (path segments omitted). */
export type ConfigDriveNamePutParams = {
  changer?: string;
  'changer-drivenum'?: `${number}`;
  delete?: readonly ('changer' | 'changer-drivenum')[];
  digest?: string;
  path?: string;
};
/** PUT /config/drive/{name} — `data` payload after client unwrap. */
export type ConfigDriveNamePutReturn = null;

/** DELETE /config/drive/{name} — `data` payload after client unwrap. */
export type ConfigDriveNameDeleteReturn = null;

/** GET /config/encryption-keys — form/query parameters (path segments omitted). */
export type ConfigEncryptionKeysGetParams = { 'include-archived'?: '0' | '1' };
/** GET /config/encryption-keys — `data` payload after client unwrap. */
export type ConfigEncryptionKeysGetReturn = readonly {
  'archived-at'?: number;
  created: number;
  fingerprint?: string;
  hint?: string;
  id: string;
  kdf: 'none' | 'scrypt' | 'pbkdf2';
  modified: number;
  path?: string;
}[];

/** POST /config/encryption-keys — form/query parameters (path segments omitted). */
export type ConfigEncryptionKeysPostParams = { id: string; key?: string };
/** POST /config/encryption-keys — `data` payload after client unwrap. */
export type ConfigEncryptionKeysPostReturn = null;

/** POST /config/encryption-keys/{id} — form/query parameters (path segments omitted). */
export type ConfigEncryptionKeysIdPostParams = { digest?: string };
/** POST /config/encryption-keys/{id} — `data` payload after client unwrap. */
export type ConfigEncryptionKeysIdPostReturn = null;

/** DELETE /config/encryption-keys/{id} — form/query parameters (path segments omitted). */
export type ConfigEncryptionKeysIdDeleteParams = { digest?: string };
/** DELETE /config/encryption-keys/{id} — `data` payload after client unwrap. */
export type ConfigEncryptionKeysIdDeleteReturn = null;
