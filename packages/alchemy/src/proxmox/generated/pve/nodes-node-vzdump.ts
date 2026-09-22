/**
 * Generated pve-manager API types for `/nodes/node/vzdump` — DO NOT EDIT BY HAND.
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

/** POST /nodes/{node}/vzdump — form/query parameters (path segments omitted). */
export type NodesNodeVzdumpPostParams = {
  all?: '0' | '1';
  bwlimit?: `${number}`;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dumpdir?: string;
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: string;
  ionice?: `${number}`;
  'job-id'?: string;
  lockwait?: `${number}`;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
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
  script?: string;
  stdexcludes?: '0' | '1';
  stdout?: '0' | '1';
  stop?: '0' | '1';
  stopwait?: `${number}`;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: `${number}`;
};
/** POST /nodes/{node}/vzdump — `data` payload after client unwrap. */
export type NodesNodeVzdumpPostReturn = string;

/** GET /nodes/{node}/vzdump/defaults — form/query parameters (path segments omitted). */
export type NodesNodeVzdumpDefaultsGetParams = { storage?: string };
/** GET /nodes/{node}/vzdump/defaults — `data` payload after client unwrap. */
export type NodesNodeVzdumpDefaultsGetReturn = {
  all?: boolean | 0 | 1;
  bwlimit?: number;
  compress?: '0' | '1' | 'gzip' | 'lzo' | 'zstd';
  dumpdir?: string;
  exclude?: string;
  'exclude-path'?: readonly string[];
  fleecing?: string;
  ionice?: number;
  lockwait?: number;
  mailnotification?: 'always' | 'failure';
  mailto?: string;
  mode?: 'snapshot' | 'suspend' | 'stop';
  node?: string;
  'notes-template'?: string;
  'notification-mode'?: 'auto' | 'legacy-sendmail' | 'notification-system';
  'pbs-change-detection-mode'?: 'legacy' | 'data' | 'metadata';
  performance?: string;
  pigz?: number;
  pool?: string;
  protected?: boolean | 0 | 1;
  'prune-backups'?: string;
  quiet?: boolean | 0 | 1;
  remove?: boolean | 0 | 1;
  script?: string;
  stdexcludes?: boolean | 0 | 1;
  stop?: boolean | 0 | 1;
  stopwait?: number;
  storage?: string;
  tmpdir?: string;
  vmid?: string;
  zstd?: number;
};

/** GET /nodes/{node}/vzdump/extractconfig — form/query parameters (path segments omitted). */
export type NodesNodeVzdumpExtractconfigGetParams = { volume: string };
/** GET /nodes/{node}/vzdump/extractconfig — `data` payload after client unwrap. */
export type NodesNodeVzdumpExtractconfigGetReturn = string;

/** POST /nodes/{node}/wakeonlan — `data` payload after client unwrap. */
export type NodesNodeWakeonlanPostReturn = string;
