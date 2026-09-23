/**
 * Generated proxmox-backup-server API types for `/config` — DO NOT EDIT BY HAND.
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

/** GET /config — `data` payload after client unwrap. */
export type ConfigGetReturn = null;

/** GET /config/access — `data` payload after client unwrap. */
export type ConfigAccessGetReturn = null;

/** GET /config/access/ad — `data` payload after client unwrap. */
export type ConfigAccessAdGetReturn = readonly {
  'base-dn'?: string;
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
  'user-classes'?: string;
  verify?: boolean | 0 | 1;
}[];

/** POST /config/access/ad — form/query parameters (path segments omitted). */
export type ConfigAccessAdPostParams = {
  'base-dn'?: string;
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
  'user-classes'?: string;
  verify?: '0' | '1';
};
/** POST /config/access/ad — `data` payload after client unwrap. */
export type ConfigAccessAdPostReturn = null;

/** GET /config/access/ad/{realm} — `data` payload after client unwrap. */
export type ConfigAccessAdRealmGetReturn = {
  'base-dn'?: string;
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
  'user-classes'?: string;
  verify?: boolean | 0 | 1;
};

/** PUT /config/access/ad/{realm} — form/query parameters (path segments omitted). */
export type ConfigAccessAdRealmPutParams = {
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
  'user-classes'?: string;
  verify?: '0' | '1';
};
/** PUT /config/access/ad/{realm} — `data` payload after client unwrap. */
export type ConfigAccessAdRealmPutReturn = {
  'base-dn'?: string;
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
  'user-classes'?: string;
  verify?: boolean | 0 | 1;
};

/** DELETE /config/access/ad/{realm} — form/query parameters (path segments omitted). */
export type ConfigAccessAdRealmDeleteParams = { digest?: string };
/** DELETE /config/access/ad/{realm} — `data` payload after client unwrap. */
export type ConfigAccessAdRealmDeleteReturn = null;
