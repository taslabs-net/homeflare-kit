/**
 * Generated proxmox-backup-server API types for `/config/notifications` — DO NOT EDIT BY HAND.
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

/** GET /config/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailGetReturn = readonly {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  filter?: string;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
}[];

/** POST /config/notifications/endpoints/sendmail — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSendmailPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  filter?: string;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
};
/** POST /config/notifications/endpoints/sendmail — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailPostReturn = null;

/** GET /config/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailNameGetReturn = {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  filter?: string;
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
};

/** PUT /config/notifications/endpoints/sendmail/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSendmailNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly ('author' | 'comment' | 'disable' | 'from-address' | 'mailto' | 'mailto-user')[];
  digest?: string;
  disable?: '0' | '1';
  'from-address'?: string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
};
/** PUT /config/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailNamePutReturn = null;

/** DELETE /config/notifications/endpoints/sendmail/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSendmailNameDeleteReturn = null;

/** GET /config/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpGetReturn = readonly {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  port?: number;
  server: string;
  username?: string;
}[];

/** POST /config/notifications/endpoints/smtp — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSmtpPostParams = {
  author?: string;
  comment?: string;
  disable?: '0' | '1';
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  password?: string;
  port?: `${number}`;
  server: string;
  username?: string;
};
/** POST /config/notifications/endpoints/smtp — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpPostReturn = null;

/** GET /config/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpNameGetReturn = {
  author?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  'from-address': string;
  mailto?: readonly string[];
  'mailto-user'?: readonly string[];
  mode?: 'insecure' | 'starttls' | 'tls';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  port?: number;
  server: string;
  username?: string;
};

/** PUT /config/notifications/endpoints/smtp/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsSmtpNamePutParams = {
  author?: string;
  comment?: string;
  delete?: readonly (
    | 'author'
    | 'comment'
    | 'disable'
    | 'mailto'
    | 'mailto-user'
    | 'password'
    | 'port'
    | 'username')[];
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
/** PUT /config/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpNamePutReturn = null;

/** DELETE /config/notifications/endpoints/smtp/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsSmtpNameDeleteReturn = null;

/** GET /config/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookGetReturn = readonly {
  body?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
}[];

/** POST /config/notifications/endpoints/webhook — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsWebhookPostParams = {
  body?: string;
  comment?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
};
/** POST /config/notifications/endpoints/webhook — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookPostReturn = null;

/** GET /config/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookNameGetReturn = {
  body?: string;
  comment?: string;
  disable?: boolean | 0 | 1;
  header?: readonly string[];
  method: 'post' | 'put' | 'get';
  name: string;
  origin?: 'user-created' | 'builtin' | 'modified-builtin';
  secret?: readonly string[];
  url: string;
};

/** PUT /config/notifications/endpoints/webhook/{name} — form/query parameters (path segments omitted). */
export type ConfigNotificationsEndpointsWebhookNamePutParams = {
  body?: string;
  comment?: string;
  delete?: readonly ('comment' | 'disable' | 'header' | 'body' | 'secret')[];
  digest?: string;
  disable?: '0' | '1';
  header?: readonly string[];
  method?: 'post' | 'put' | 'get';
  secret?: readonly string[];
  url?: string;
};
/** PUT /config/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookNamePutReturn = null;

/** DELETE /config/notifications/endpoints/webhook/{name} — `data` payload after client unwrap. */
export type ConfigNotificationsEndpointsWebhookNameDeleteReturn = null;

/** GET /config/notifications/matcher-field-values — `data` payload after client unwrap. */
export type ConfigNotificationsMatcherFieldValuesGetReturn = readonly {
  comment?: string;
  field: string;
  value: string;
}[];

/** GET /config/notifications/matcher-fields — `data` payload after client unwrap. */
export type ConfigNotificationsMatcherFieldsGetReturn = readonly { name: string }[];
