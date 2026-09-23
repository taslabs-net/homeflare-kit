/**
 * Generated pve-manager API types for `/access` — DO NOT EDIT BY HAND.
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

/** GET /access — `data` payload after client unwrap. */
export type AccessGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** GET /access/acl — `data` payload after client unwrap. */
export type AccessAclGetReturn = readonly {
  path: string;
  propagate?: boolean | 0 | 1;
  roleid: string;
  type: 'user' | 'group' | 'token';
  ugid: string;
}[];

/** PUT /access/acl — form/query parameters (path segments omitted). */
export type AccessAclPutParams = {
  delete?: '0' | '1';
  groups?: string;
  path: string;
  propagate?: '0' | '1';
  roles: string;
  tokens?: string;
  users?: string;
};
/** PUT /access/acl — `data` payload after client unwrap. */
export type AccessAclPutReturn = null;

/** GET /access/domains — `data` payload after client unwrap. */
export type AccessDomainsGetReturn = readonly ({
  comment?: string;
  realm: string;
  tfa?: 'yubico' | 'oath';
  type: string;
} & Record<string, unknown>)[];

/** POST /access/domains — form/query parameters (path segments omitted). */
export type AccessDomainsPostParams = {
  'acr-values'?: string;
  audiences?: string;
  autocreate?: '0' | '1';
  base_dn?: string;
  bind_dn?: string;
  capath?: string;
  'case-sensitive'?: '0' | '1';
  cert?: string;
  certkey?: string;
  'check-connection'?: '0' | '1';
  'client-id'?: string;
  'client-key'?: string;
  comment?: string;
  default?: '0' | '1';
  domain?: string;
  filter?: string;
  group_classes?: string;
  group_dn?: string;
  group_filter?: string;
  group_name_attr?: string;
  'groups-autocreate'?: '0' | '1';
  'groups-claim'?: string;
  'groups-overwrite'?: '0' | '1';
  'issuer-url'?: string;
  mode?: 'ldap' | 'ldaps' | 'ldap+starttls';
  password?: string;
  port?: `${number}`;
  prompt?: string;
  'query-userinfo'?: '0' | '1';
  realm: string;
  scopes?: string;
  secure?: '0' | '1';
  server1?: string;
  server2?: string;
  sslversion?: 'tlsv1' | 'tlsv1_1' | 'tlsv1_2' | 'tlsv1_3';
  'sync-defaults-options'?: string;
  sync_attributes?: string;
  tfa?: string;
  type: 'ad' | 'ldap' | 'openid' | 'pam' | 'pve';
  user_attr?: string;
  user_classes?: string;
  'username-claim'?: string;
  verify?: '0' | '1';
};
/** POST /access/domains — `data` payload after client unwrap. */
export type AccessDomainsPostReturn = null;

/** GET /access/domains/{realm} — `data` payload after client unwrap. */
export type AccessDomainsRealmGetReturn = unknown;

/** PUT /access/domains/{realm} — form/query parameters (path segments omitted). */
export type AccessDomainsRealmPutParams = {
  'acr-values'?: string;
  audiences?: string;
  autocreate?: '0' | '1';
  base_dn?: string;
  bind_dn?: string;
  capath?: string;
  'case-sensitive'?: '0' | '1';
  cert?: string;
  certkey?: string;
  'check-connection'?: '0' | '1';
  'client-id'?: string;
  'client-key'?: string;
  comment?: string;
  default?: '0' | '1';
  delete?: string;
  digest?: string;
  domain?: string;
  filter?: string;
  group_classes?: string;
  group_dn?: string;
  group_filter?: string;
  group_name_attr?: string;
  'groups-autocreate'?: '0' | '1';
  'groups-claim'?: string;
  'groups-overwrite'?: '0' | '1';
  'issuer-url'?: string;
  mode?: 'ldap' | 'ldaps' | 'ldap+starttls';
  password?: string;
  port?: `${number}`;
  prompt?: string;
  'query-userinfo'?: '0' | '1';
  scopes?: string;
  secure?: '0' | '1';
  server1?: string;
  server2?: string;
  sslversion?: 'tlsv1' | 'tlsv1_1' | 'tlsv1_2' | 'tlsv1_3';
  'sync-defaults-options'?: string;
  sync_attributes?: string;
  tfa?: string;
  user_attr?: string;
  user_classes?: string;
  verify?: '0' | '1';
};
/** PUT /access/domains/{realm} — `data` payload after client unwrap. */
export type AccessDomainsRealmPutReturn = null;

/** DELETE /access/domains/{realm} — `data` payload after client unwrap. */
export type AccessDomainsRealmDeleteReturn = null;

/** POST /access/domains/{realm}/sync — form/query parameters (path segments omitted). */
export type AccessDomainsRealmSyncPostParams = {
  'dry-run'?: '0' | '1';
  'enable-new': '0' | '1';
  full: '0' | '1';
  purge: '0' | '1';
  'remove-vanished': string;
  scope: 'users' | 'groups' | 'both';
};
/** POST /access/domains/{realm}/sync — `data` payload after client unwrap. */
export type AccessDomainsRealmSyncPostReturn = string;

/** GET /access/groups — `data` payload after client unwrap. */
export type AccessGroupsGetReturn = readonly ({
  comment?: string;
  groupid: string;
  users?: string;
} & Record<string, unknown>)[];

/** POST /access/groups — form/query parameters (path segments omitted). */
export type AccessGroupsPostParams = { comment?: string; groupid: string };
/** POST /access/groups — `data` payload after client unwrap. */
export type AccessGroupsPostReturn = null;

/** GET /access/groups/{groupid} — `data` payload after client unwrap. */
export type AccessGroupsGroupidGetReturn = { comment?: string; members: readonly string[] };

/** PUT /access/groups/{groupid} — form/query parameters (path segments omitted). */
export type AccessGroupsGroupidPutParams = { comment?: string };
/** PUT /access/groups/{groupid} — `data` payload after client unwrap. */
export type AccessGroupsGroupidPutReturn = null;

/** DELETE /access/groups/{groupid} — `data` payload after client unwrap. */
export type AccessGroupsGroupidDeleteReturn = null;

/** GET /access/openid — `data` payload after client unwrap. */
export type AccessOpenidGetReturn = readonly ({ subdir: string } & Record<string, unknown>)[];

/** POST /access/openid/auth-url — form/query parameters (path segments omitted). */
export type AccessOpenidAuthUrlPostParams = { realm: string; 'redirect-url': string };
/** POST /access/openid/auth-url — `data` payload after client unwrap. */
export type AccessOpenidAuthUrlPostReturn = string;

/** POST /access/openid/login — form/query parameters (path segments omitted). */
export type AccessOpenidLoginPostParams = { code: string; 'redirect-url': string; state: string };
/** POST /access/openid/login — `data` payload after client unwrap. */
export type AccessOpenidLoginPostReturn = {
  CSRFPreventionToken: string;
  cap: unknown;
  clustername?: string;
  ticket: string;
  username: string;
} & Record<string, unknown>;

/** PUT /access/password — form/query parameters (path segments omitted). */
export type AccessPasswordPutParams = {
  'confirmation-password'?: string;
  password: string;
  userid: string;
};
/** PUT /access/password — `data` payload after client unwrap. */
export type AccessPasswordPutReturn = null;

/** GET /access/permissions — form/query parameters (path segments omitted). */
export type AccessPermissionsGetParams = { path?: string; userid?: string };
/** GET /access/permissions — `data` payload after client unwrap. */
export type AccessPermissionsGetReturn = unknown;
