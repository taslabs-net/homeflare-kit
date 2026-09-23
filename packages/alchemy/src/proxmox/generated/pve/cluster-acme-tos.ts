/**
 * Generated pve-manager API types for `/cluster/acme/tos` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pve/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 */

/** GET /cluster/acme/tos — form/query parameters (path segments omitted). */
export type ClusterAcmeTosGetParams = { directory?: string };
/** GET /cluster/acme/tos — `data` payload after client unwrap. */
export type ClusterAcmeTosGetReturn = string;

/** GET /cluster/backup — `data` payload after client unwrap. */
export type ClusterBackupGetReturn = readonly ({
  all?: boolean | 0 | 1;
  bwlimit?: number;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dumpdir?: string;
  enabled?: boolean | 0 | 1;
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: { enabled?: boolean | 0 | 1; storage?: string } & Record<string, unknown>;
  id: string;
  ionice?: number;
  lockwait?: number;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  'next-run'?: number;
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: { 'max-workers'?: number; 'pbs-entries-max'?: number } & Record<string, unknown>;
  pigz?: number;
  pool?: string;
  protected?: boolean | 0 | 1;
  'prune-backups'?: {
    'keep-all'?: boolean | 0 | 1;
    'keep-daily'?: number;
    'keep-hourly'?: number;
    'keep-last'?: number;
    'keep-monthly'?: number;
    'keep-weekly'?: number;
    'keep-yearly'?: number;
  } & Record<string, unknown>;
  quiet?: boolean | 0 | 1;
  remove?: boolean | 0 | 1;
  'repeat-missed'?: boolean | 0 | 1;
  schedule?: string;
  script?: string;
  stdexcludes?: boolean | 0 | 1;
  stop?: boolean | 0 | 1;
  stopwait?: number;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: number;
} & Record<string, unknown>)[];

/** POST /cluster/backup — form/query parameters (path segments omitted). */
export type ClusterBackupPostParams = {
  all?: '0' | '1';
  bwlimit?: `${number}`;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dow?: string;
  dumpdir?: string;
  enabled?: '0' | '1';
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: string;
  id?: string;
  ionice?: `${number}`;
  lockwait?: `${number}`;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: string;
  pigz?: `${number}`;
  pool?: string;
  protected?: '0' | '1';
  'prune-backups'?: string;
  quiet?: '0' | '1';
  remove?: '0' | '1';
  'repeat-missed'?: '0' | '1';
  schedule?: string;
  script?: string;
  starttime?: string;
  stdexcludes?: '0' | '1';
  stop?: '0' | '1';
  stopwait?: `${number}`;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: `${number}`;
};
/** POST /cluster/backup — `data` payload after client unwrap. */
export type ClusterBackupPostReturn = null;

/** GET /cluster/backup/{id} — `data` payload after client unwrap. */
export type ClusterBackupIdGetReturn = {
  all?: boolean | 0 | 1;
  bwlimit?: number;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dumpdir?: string;
  enabled?: boolean | 0 | 1;
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: { enabled?: boolean | 0 | 1; storage?: string } & Record<string, unknown>;
  id: string;
  ionice?: number;
  lockwait?: number;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  'next-run'?: number;
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: { 'max-workers'?: number; 'pbs-entries-max'?: number } & Record<string, unknown>;
  pigz?: number;
  pool?: string;
  protected?: boolean | 0 | 1;
  'prune-backups'?: {
    'keep-all'?: boolean | 0 | 1;
    'keep-daily'?: number;
    'keep-hourly'?: number;
    'keep-last'?: number;
    'keep-monthly'?: number;
    'keep-weekly'?: number;
    'keep-yearly'?: number;
  } & Record<string, unknown>;
  quiet?: boolean | 0 | 1;
  remove?: boolean | 0 | 1;
  'repeat-missed'?: boolean | 0 | 1;
  schedule?: string;
  script?: string;
  stdexcludes?: boolean | 0 | 1;
  stop?: boolean | 0 | 1;
  stopwait?: number;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: number;
} & Record<string, unknown>;

/** PUT /cluster/backup/{id} — form/query parameters (path segments omitted). */
export type ClusterBackupIdPutParams = {
  all?: '0' | '1';
  bwlimit?: `${number}`;
  comment?: string;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  delete?: string;
  dow?: string;
  dumpdir?: string;
  enabled?: '0' | '1';
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: string;
  ionice?: `${number}`;
  lockwait?: `${number}`;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: string;
  pigz?: `${number}`;
  pool?: string;
  protected?: '0' | '1';
  'prune-backups'?: string;
  quiet?: '0' | '1';
  remove?: '0' | '1';
  'repeat-missed'?: '0' | '1';
  schedule?: string;
  script?: string;
  starttime?: string;
  stdexcludes?: '0' | '1';
  stop?: '0' | '1';
  stopwait?: `${number}`;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: `${number}`;
};
/** PUT /cluster/backup/{id} — `data` payload after client unwrap. */
export type ClusterBackupIdPutReturn = null;

/** DELETE /cluster/backup/{id} — `data` payload after client unwrap. */
export type ClusterBackupIdDeleteReturn = null;

/** GET /cluster/backup/{id}/included_volumes — `data` payload after client unwrap. */
export type ClusterBackupIdIncluded_volumesGetReturn = {
  children: readonly ({
    children?: readonly ({
      id: string;
      included: boolean | 0 | 1;
      name: string;
      reason: string;
    } & Record<string, unknown>)[];
    id: number;
    name?: string;
    type: 'qemu' | 'lxc' | 'unknown';
  } & Record<string, unknown>)[];
} & Record<string, unknown>;

/** GET /cluster/backup-info — `data` payload after client unwrap. */
export type ClusterBackupInfoGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /cluster/backup-info/not-backed-up — `data` payload after client unwrap. */
export type ClusterBackupInfoNotBackedUpGetReturn = readonly ({
  name?: string;
  type: 'qemu' | 'lxc';
  vmid: number;
} & Record<string, unknown>)[];
