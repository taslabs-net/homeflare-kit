/**
 * Generated proxmox-backup-server API types for `/config/notifications/matchers` — DO NOT EDIT BY HAND.
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

/** GET /config/notifications/matchers — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersGetReturn = readonly {
  comment?: string;
  disable?: boolean | 0 | 1;
  'invert-match'?: boolean | 0 | 1;
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  target?: readonly string[];
}[];

/** POST /config/notifications/matchers — form/query parameters (path segments omitted). */
export type ConfigNotificationsMatchersPostParams = {
  comment?: string;
  disable?: '0' | '1';
  'invert-match'?: '0' | '1';
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  target?: readonly string[];
};
/** POST /config/notifications/matchers — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersPostReturn = null;

/** GET /config/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersNameGetReturn = {
  comment?: string;
  disable?: boolean | 0 | 1;
  'invert-match'?: boolean | 0 | 1;
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  target?: readonly string[];
};

/** PUT /config/notifications/matchers/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsMatchersNamePutParams = {
  comment?: string;
  delete?: readonly (
    | 'comment'
    | 'disable'
    | 'invert-match'
    | 'match-calendar'
    | 'match-field'
    | 'match-severity'
    | 'mode'
    | 'target')[];
  digest?: string;
  disable?: '0' | '1';
  'invert-match'?: '0' | '1';
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  target?: readonly string[];
};
/** PUT /config/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersNamePutReturn = null;

/** DELETE /config/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsMatchersNameDeleteReturn = null;

/** GET /config/notifications/targets — `data` payload after client unwrap. */
export type ConfigNotificationsTargetsGetReturn = readonly {
  comment?: string;
  disable?: boolean | 0 | 1;
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  type: 'sendmail' | 'smtp' | 'gotify' | 'webhook';
}[];

/** GET /config/notifications/targets/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsTargetsNameGetReturn = null;

/** POST /config/notifications/targets/{name}/test — `data` payload after client unwrap. */
export type ConfigNotificationsTargetsNameTestPostReturn = null;

/** GET /config/prune — `data` payload after client unwrap. */
export type ConfigPruneGetReturn = readonly {
  comment?: string;
  disable?: boolean | 0 | 1;
  id: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'max-depth'?: number;
  ns?: string;
  schedule: string;
  store: string;
}[];

/** POST /config/prune — form/query parameters (path segments omitted). */
export type ConfigPrunePostParams = {
  comment?: string;
  disable?: '0' | '1';
  id: string;
  'keep-daily'?: `${number}`;
  'keep-hourly'?: `${number}`;
  'keep-last'?: `${number}`;
  'keep-monthly'?: `${number}`;
  'keep-weekly'?: `${number}`;
  'keep-yearly'?: `${number}`;
  'max-depth'?: `${number}`;
  ns?: string;
  schedule: string;
  store: string;
};
/** POST /config/prune — `data` payload after client unwrap. */
export type ConfigPrunePostReturn = null;

/** GET /config/prune/{id} — `data` payload after client unwrap. */
export type ConfigPruneIdGetReturn = {
  comment?: string;
  disable?: boolean | 0 | 1;
  id: string;
  'keep-daily'?: number;
  'keep-hourly'?: number;
  'keep-last'?: number;
  'keep-monthly'?: number;
  'keep-weekly'?: number;
  'keep-yearly'?: number;
  'max-depth'?: number;
  ns?: string;
  schedule: string;
  store: string;
};

/** PUT /config/prune/{id} — form/query parameters (path segments omitted). */
export type ConfigPruneIdPutParams = {
  comment?: string;
  delete?: readonly (
    | 'comment'
    | 'disable'
    | 'ns'
    | 'max-depth'
    | 'keep-last'
    | 'keep-hourly'
    | 'keep-daily'
    | 'keep-weekly'
    | 'keep-monthly'
    | 'keep-yearly')[];
  digest?: string;
  disable?: '0' | '1';
  'keep-daily'?: `${number}`;
  'keep-hourly'?: `${number}`;
  'keep-last'?: `${number}`;
  'keep-monthly'?: `${number}`;
  'keep-weekly'?: `${number}`;
  'keep-yearly'?: `${number}`;
  'max-depth'?: `${number}`;
  ns?: string;
  schedule?: string;
  store?: string;
};
/** PUT /config/prune/{id} — `data` payload after client unwrap. */
export type ConfigPruneIdPutReturn = null;

/** DELETE /config/prune/{id} — form/query parameters (path segments omitted). */
export type ConfigPruneIdDeleteParams = { digest?: string };
/** DELETE /config/prune/{id} — `data` payload after client unwrap. */
export type ConfigPruneIdDeleteReturn = null;
