/**
 * Generated proxmox-backup-server API types for `/config/tape` — DO NOT EDIT BY HAND.
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

/** GET /config/tape-backup-job — `data` payload after client unwrap. */
export type ConfigTapeBackupJobGetReturn = readonly {
  comment?: string;
  drive: string;
  'eject-media'?: boolean | 0 | 1;
  'export-media-set'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'latest-only'?: boolean | 0 | 1;
  'max-depth'?: number;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notify-user'?: string;
  ns?: string;
  pool: string;
  schedule?: string;
  store: string;
  'worker-threads'?: number;
}[];

/** POST /config/tape-backup-job — form/query parameters (path segments omitted). */
export type ConfigTapeBackupJobPostParams = {
  comment?: string;
  drive: string;
  'eject-media'?: '0' | '1';
  'export-media-set'?: '0' | '1';
  'group-filter'?: readonly string[];
  id: string;
  'latest-only'?: '0' | '1';
  'max-depth'?: `${number}`;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notify-user'?: string;
  ns?: string;
  pool: string;
  schedule?: string;
  store: string;
  'worker-threads'?: `${number}`;
};
/** POST /config/tape-backup-job — `data` payload after client unwrap. */
export type ConfigTapeBackupJobPostReturn = null;

/** GET /config/tape-backup-job/{id} — `data` payload after client unwrap. */
export type ConfigTapeBackupJobIdGetReturn = {
  comment?: string;
  drive: string;
  'eject-media'?: boolean | 0 | 1;
  'export-media-set'?: boolean | 0 | 1;
  'group-filter'?: readonly string[];
  id: string;
  'latest-only'?: boolean | 0 | 1;
  'max-depth'?: number;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notify-user'?: string;
  ns?: string;
  pool: string;
  schedule?: string;
  store: string;
  'worker-threads'?: number;
};

/** PUT /config/tape-backup-job/{id} — form/query parameters (path segments omitted). */
export type ConfigTapeBackupJobIdPutParams = {
  comment?: string;
  delete?: readonly (
    | 'comment'
    | 'schedule'
    | 'eject-media'
    | 'export-media-set'
    | 'latest-only'
    | 'notify-user'
    | 'notification-mode'
    | 'group-filter'
    | 'max-depth'
    | 'ns'
    | 'worker-threads')[];
  digest?: string;
  drive?: string;
  'eject-media'?: '0' | '1';
  'export-media-set'?: '0' | '1';
  'group-filter'?: readonly string[];
  'latest-only'?: '0' | '1';
  'max-depth'?: `${number}`;
  'notification-mode'?: 'legacy-sendmail' | 'notification-system';
  'notify-user'?: string;
  ns?: string;
  pool?: string;
  schedule?: string;
  store?: string;
  'worker-threads'?: `${number}`;
};
/** PUT /config/tape-backup-job/{id} — `data` payload after client unwrap. */
export type ConfigTapeBackupJobIdPutReturn = null;

/** DELETE /config/tape-backup-job/{id} — form/query parameters (path segments omitted). */
export type ConfigTapeBackupJobIdDeleteParams = { digest?: string };
/** DELETE /config/tape-backup-job/{id} — `data` payload after client unwrap. */
export type ConfigTapeBackupJobIdDeleteReturn = null;

/** GET /config/tape-encryption-keys — `data` payload after client unwrap. */
export type ConfigTapeEncryptionKeysGetReturn = readonly {
  created: number;
  fingerprint?: string;
  hint?: string;
  kdf: 'none' | 'scrypt' | 'pbkdf2';
  modified: number;
  path?: string;
}[];

/** POST /config/tape-encryption-keys — form/query parameters (path segments omitted). */
export type ConfigTapeEncryptionKeysPostParams = {
  hint?: string;
  kdf?: 'none' | 'scrypt' | 'pbkdf2';
  key?: string;
  password: string;
};
/** POST /config/tape-encryption-keys — `data` payload after client unwrap. */
export type ConfigTapeEncryptionKeysPostReturn = string;

/** GET /config/tape-encryption-keys/{fingerprint} — `data` payload after client unwrap. */
export type ConfigTapeEncryptionKeysFingerprintGetReturn = {
  created: number;
  fingerprint?: string;
  hint?: string;
  kdf: 'none' | 'scrypt' | 'pbkdf2';
  modified: number;
  path?: string;
};

/** PUT /config/tape-encryption-keys/{fingerprint} — form/query parameters (path segments omitted). */
export type ConfigTapeEncryptionKeysFingerprintPutParams = {
  digest?: string;
  force?: '0' | '1';
  hint: string;
  kdf?: 'none' | 'scrypt' | 'pbkdf2';
  'new-password': string;
  password?: string;
};
/** PUT /config/tape-encryption-keys/{fingerprint} — `data` payload after client unwrap. */
export type ConfigTapeEncryptionKeysFingerprintPutReturn = null;

/** DELETE /config/tape-encryption-keys/{fingerprint} — form/query parameters (path segments omitted). */
export type ConfigTapeEncryptionKeysFingerprintDeleteParams = { digest?: string };
/** DELETE /config/tape-encryption-keys/{fingerprint} — `data` payload after client unwrap. */
export type ConfigTapeEncryptionKeysFingerprintDeleteReturn = null;

/** GET /config/traffic-control — `data` payload after client unwrap. */
export type ConfigTrafficControlGetReturn = readonly {
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  name: string;
  network: readonly string[];
  'rate-in'?: string;
  'rate-out'?: string;
  timeframe?: readonly string[];
  users?: readonly string[];
}[];

/** POST /config/traffic-control — form/query parameters (path segments omitted). */
export type ConfigTrafficControlPostParams = {
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  name: string;
  network: readonly string[];
  'rate-in'?: string;
  'rate-out'?: string;
  timeframe?: readonly string[];
  users?: readonly string[];
};
/** POST /config/traffic-control — `data` payload after client unwrap. */
export type ConfigTrafficControlPostReturn = null;

/** GET /config/traffic-control/{name} — `data` payload after client unwrap. */
export type ConfigTrafficControlNameGetReturn = {
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  name: string;
  network: readonly string[];
  'rate-in'?: string;
  'rate-out'?: string;
  timeframe?: readonly string[];
  users?: readonly string[];
};

/** PUT /config/traffic-control/{name} — form/query parameters (path segments omitted). */
export type ConfigTrafficControlNamePutParams = {
  'burst-in'?: string;
  'burst-out'?: string;
  comment?: string;
  delete?: readonly (
    | 'rate-in'
    | 'burst-in'
    | 'rate-out'
    | 'burst-out'
    | 'comment'
    | 'timeframe'
    | 'users')[];
  digest?: string;
  network?: readonly string[];
  'rate-in'?: string;
  'rate-out'?: string;
  timeframe?: readonly string[];
  users?: readonly string[];
};
/** PUT /config/traffic-control/{name} — `data` payload after client unwrap. */
export type ConfigTrafficControlNamePutReturn = null;

/** DELETE /config/traffic-control/{name} — form/query parameters (path segments omitted). */
export type ConfigTrafficControlNameDeleteParams = { digest?: string };
/** DELETE /config/traffic-control/{name} — `data` payload after client unwrap. */
export type ConfigTrafficControlNameDeleteReturn = null;
