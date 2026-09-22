/**
 * Generated pve-manager API types for `/cluster/notifications/endpoints` — DO NOT EDIT BY HAND.
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

/** GET /cluster/notifications/endpoints — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailGetReturn = readonly ({
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/sendmail — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSendmailPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
};
/** POST /cluster/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailPostReturn = null;

/** GET /cluster/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailNameGetReturn = {
  author?: string;
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/sendmail/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSendmailNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
};
/** PUT /cluster/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSendmailNameDeleteReturn = null;

/** GET /cluster/notifications/endpoints/gotify — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyGetReturn = readonly ({
  comment?: string;
  disable?: boolean | 0 | 1;
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  server: string;
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/gotify — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsGotifyPostParams = {
  comment?: string;
  disable?: '0' | '1';
  name: string;
  server: string;
  token: string;
};
/** POST /cluster/notifications/endpoints/gotify — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyPostReturn = null;

/** GET /cluster/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyNameGetReturn = {
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  name: string;
  server: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/gotify/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsGotifyNamePutParams = {
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  server?: string;
  token?: string;
};
/** PUT /cluster/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/gotify/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsGotifyNameDeleteReturn = null;

/** GET /cluster/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpGetReturn = readonly ({
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  port?: number;
  server: string;
  username?: string;
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/smtp — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSmtpPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  password?: string;
  port?: `${number}`;
  server: string;
  username?: string;
};
/** POST /cluster/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpPostReturn = null;

/** GET /cluster/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpNameGetReturn = {
  author?: string;
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  port?: number;
  server: string;
  username?: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/smtp/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsSmtpNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  password?: string;
  port?: `${number}`;
  server?: string;
  username?: string;
};
/** PUT /cluster/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsSmtpNameDeleteReturn = null;

/** GET /cluster/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookGetReturn = readonly ({
  body?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
} & Record<string, unknown>)[];

/** POST /cluster/notifications/endpoints/webhook — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsWebhookPostParams = {
  body?: string;
  comment?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  secret?: readonly string[];
  url: string;
};
/** POST /cluster/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookPostReturn = null;

/** GET /cluster/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookNameGetReturn = {
  body?: string;
  comment?: string;
  digest?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  secret?: readonly string[];
  url: string;
} & Record<string, unknown>;

/** PUT /cluster/notifications/endpoints/webhook/{name} — form/query parameters (path segments omitted). */
export type ClusterNotificationsEndpointsWebhookNamePutParams = {
  body?: string;
  comment?: string;
  delete?: readonly string[];
  digest?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method?: 'post' | 'put' | 'get';
  secret?: readonly string[];
  url?: string;
};
/** PUT /cluster/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookNamePutReturn = null;

/** DELETE /cluster/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ClusterNotificationsEndpointsWebhookNameDeleteReturn = null;
