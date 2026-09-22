/**
 * Generated pve-manager API types for `/cluster/notifications` — DO NOT EDIT BY HAND.
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

/** GET /cluster/notifications/matcher-field-values — `data` payload after client unwrap. */
export type ClusterNotificationsMatcherFieldValuesGetReturn = readonly ({
  comment?: string;
  field: string;
  value: string;
} & Record<string, unknown>)[];

/** GET /cluster/notifications/matcher-fields — `data` payload after client unwrap. */
export type ClusterNotificationsMatcherFieldsGetReturn = readonly ({
  name: string;
} & Record<string, unknown>)[];

/** GET /cluster/notifications/matchers — `data` payload after client unwrap. */
export type ClusterNotificationsMatchersGetReturn = readonly ({
  comment?: string;
  disable?: boolean | 0 | 1;
  'invert-match'?: boolean | 0 | 1;
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  target?: readonly string[];
} & Record<string, unknown>)[];

/** POST /cluster/notifications/matchers — form/query parameters (path segments omitted). */
export type ClusterNotificationsMatchersPostParams = {
  comment?: string;
  disable?: '0' | '1';
  'invert-match'?: '0' | '1';
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  target?: readonly string[];
};
/** POST /cluster/notifications/matchers — `data` payload after client unwrap. */
export type ClusterNotificationsMatchersPostReturn = null;

/** GET /cluster/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsMatchersNameGetReturn = {
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  'invert-match'?: boolean | 0 | 1;
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  name: string;
  target?: readonly string[];
} & Record<string, unknown>;

/** PUT /cluster/notifications/matchers/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsMatchersNamePutParams = {
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  'invert-match'?: '0' | '1';
  'match-calendar'?: readonly string[];
  'match-field'?: readonly string[];
  'match-severity'?: readonly string[];
  mode?: 'all' | 'any';
  target?: readonly string[];
};
/** PUT /cluster/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsMatchersNamePutReturn = null;

/** DELETE /cluster/notifications/matchers/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsMatchersNameDeleteReturn = null;

/** GET /cluster/notifications/targets — `data` payload after client unwrap. */
export type ClusterNotificationsTargetsGetReturn = readonly ({
  comment?: string;
  disable?: boolean | 0 | 1;
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  type: 'sendmail' | 'gotify' | 'smtp' | 'webhook';
} & Record<string, unknown>)[];

/** POST /cluster/notifications/targets/{name}/test — `data` payload after client unwrap. */
export type ClusterNotificationsTargetsNameTestPostReturn = null;
