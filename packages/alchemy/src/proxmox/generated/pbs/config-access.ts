/**
 * Generated proxmox-backup-server API types for `/config/access` — DO NOT EDIT BY HAND.
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

/** GET /config/access/ldap — `data` payload after client unwrap. */
export type ConfigAccessLdapGetReturn = readonly {
  'base-dn': string;
  'bind-dn'?: string;
  capath?: string;
  comment?: string;
  default?: boolean | 0 | 1;
  filter?: string;
  mode?: 'ldap' | 'ldap+starttls' | 'ldaps';
  port?: number;
  realm: string;
  server1: string;
  server2?: string;
  'sync-attributes'?: string;
  'sync-defaults-options'?: string;
  'user-attr': string;
  'user-classes'?: string;
  verify?: boolean | 0 | 1;
}[];

/** POST /config/access/ldap — form/query parameters (path segments omitted). */
export type ConfigAccessLdapPostParams = {
  'base-dn': string;
  'bind-dn'?: string;
  capath?: string;
  comment?: string;
  default?: '0' | '1';
  filter?: string;
  mode?: 'ldap' | 'ldap+starttls' | 'ldaps';
  password?: string;
  port?: `${number}`;
  realm: string;
  server1: string;
  server2?: string;
  'sync-attributes'?: string;
  'sync-defaults-options'?: string;
  'user-attr': string;
  'user-classes'?: string;
  verify?: '0' | '1';
};
/** POST /config/access/ldap — `data` payload after client unwrap. */
export type ConfigAccessLdapPostReturn = null;

/** GET /config/access/ldap/{realm} — `data` payload after client unwrap. */
export type ConfigAccessLdapRealmGetReturn = {
  'base-dn': string;
  'bind-dn'?: string;
  capath?: string;
  comment?: string;
  default?: boolean | 0 | 1;
  filter?: string;
  mode?: 'ldap' | 'ldap+starttls' | 'ldaps';
  port?: number;
  realm: string;
  server1: string;
  server2?: string;
  'sync-attributes'?: string;
  'sync-defaults-options'?: string;
  'user-attr': string;
  'user-classes'?: string;
  verify?: boolean | 0 | 1;
};

/** PUT /config/access/ldap/{realm} — form/query parameters (path segments omitted). */
export type ConfigAccessLdapRealmPutParams = {
  'base-dn'?: string;
  'bind-dn'?: string;
  capath?: string;
  comment?: string;
  default?: '0' | '1';
  delete?: readonly (
    | 'server2'
    | 'port'
    | 'comment'
    | 'default'
    | 'verify'
    | 'mode'
    | 'bind-dn'
    | 'password'
    | 'filter'
    | 'sync-defaults-options'
    | 'sync-attributes'
    | 'user-classes')[];
  digest?: string;
  filter?: string;
  mode?: 'ldap' | 'ldap+starttls' | 'ldaps';
  password?: string;
  port?: `${number}`;
  server1?: string;
  server2?: string;
  'sync-attributes'?: string;
  'sync-defaults-options'?: string;
  'user-attr'?: string;
  'user-classes'?: string;
  verify?: '0' | '1';
};
/** PUT /config/access/ldap/{realm} — `data` payload after client unwrap. */
export type ConfigAccessLdapRealmPutReturn = {
  'base-dn': string;
  'bind-dn'?: string;
  capath?: string;
  comment?: string;
  default?: boolean | 0 | 1;
  filter?: string;
  mode?: 'ldap' | 'ldap+starttls' | 'ldaps';
  port?: number;
  realm: string;
  server1: string;
  server2?: string;
  'sync-attributes'?: string;
  'sync-defaults-options'?: string;
  'user-attr': string;
  'user-classes'?: string;
  verify?: boolean | 0 | 1;
};

/** DELETE /config/access/ldap/{realm} — form/query parameters (path segments omitted). */
export type ConfigAccessLdapRealmDeleteParams = { digest?: string };
/** DELETE /config/access/ldap/{realm} — `data` payload after client unwrap. */
export type ConfigAccessLdapRealmDeleteReturn = null;

/** GET /config/access/openid — `data` payload after client unwrap. */
export type ConfigAccessOpenidGetReturn = readonly {
  'acr-values'?: string;
  audiences?: string;
  autocreate?: boolean | 0 | 1;
  'client-id': string;
  'client-key'?: string;
  comment?: string;
  default?: boolean | 0 | 1;
  'issuer-url': string;
  prompt?: string;
  realm: string;
  scopes?: string;
  'username-claim'?: string;
}[];

/** POST /config/access/openid — form/query parameters (path segments omitted). */
export type ConfigAccessOpenidPostParams = {
  'acr-values'?: string;
  audiences?: string;
  autocreate?: '0' | '1';
  'client-id': string;
  'client-key'?: string;
  comment?: string;
  default?: '0' | '1';
  'issuer-url': string;
  prompt?: string;
  realm: string;
  scopes?: string;
  'username-claim'?: string;
};
/** POST /config/access/openid — `data` payload after client unwrap. */
export type ConfigAccessOpenidPostReturn = null;

/** GET /config/access/openid/{realm} — `data` payload after client unwrap. */
export type ConfigAccessOpenidRealmGetReturn = {
  'acr-values'?: string;
  audiences?: string;
  autocreate?: boolean | 0 | 1;
  'client-id': string;
  'client-key'?: string;
  comment?: string;
  default?: boolean | 0 | 1;
  'issuer-url': string;
  prompt?: string;
  realm: string;
  scopes?: string;
  'username-claim'?: string;
};

/** PUT /config/access/openid/{realm} — form/query parameters (path segments omitted). */
export type ConfigAccessOpenidRealmPutParams = {
  'acr-values'?: string;
  audiences?: string;
  autocreate?: '0' | '1';
  'client-id'?: string;
  'client-key'?: string;
  comment?: string;
  default?: '0' | '1';
  delete?: readonly (
    | 'client-key'
    | 'comment'
    | 'default'
    | 'autocreate'
    | 'scopes'
    | 'prompt'
    | 'acr-values'
    | 'audiences')[];
  digest?: string;
  'issuer-url'?: string;
  prompt?: string;
  scopes?: string;
};
/** PUT /config/access/openid/{realm} — `data` payload after client unwrap. */
export type ConfigAccessOpenidRealmPutReturn = {
  'acr-values'?: string;
  audiences?: string;
  autocreate?: boolean | 0 | 1;
  'client-id': string;
  'client-key'?: string;
  comment?: string;
  default?: boolean | 0 | 1;
  'issuer-url': string;
  prompt?: string;
  realm: string;
  scopes?: string;
  'username-claim'?: string;
};

/** DELETE /config/access/openid/{realm} — form/query parameters (path segments omitted). */
export type ConfigAccessOpenidRealmDeleteParams = { digest?: string };
/** DELETE /config/access/openid/{realm} — `data` payload after client unwrap. */
export type ConfigAccessOpenidRealmDeleteReturn = null;
