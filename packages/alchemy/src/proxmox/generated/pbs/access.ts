/**
 * Generated proxmox-backup-server API types for `/access` — DO NOT EDIT BY HAND.
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

/** GET /access — `data` payload after client unwrap. */
export type AccessGetReturn = null;

/** GET /access/acl — form/query parameters (path segments omitted). */
export type AccessAclGetParams = { exact?: '0' | '1'; path?: string };
/** GET /access/acl — `data` payload after client unwrap. */
export type AccessAclGetReturn = readonly {
  path: string;
  propagate: boolean | 0 | 1;
  roleid:
    | 'Admin'
    | 'Audit'
    | 'NoAccess'
    | 'DatastoreAdmin'
    | 'DatastoreReader'
    | 'DatastoreBackup'
    | 'DatastorePowerUser'
    | 'DatastoreAudit'
    | 'RemoteAudit'
    | 'RemoteAdmin'
    | 'RemoteSyncOperator'
    | 'RemoteSyncPushOperator'
    | 'RemoteDatastorePowerUser'
    | 'RemoteDatastoreAdmin'
    | 'TapeAudit'
    | 'TapeAdmin'
    | 'TapeOperator'
    | 'TapeReader';
  ugid: string;
  ugid_type: 'user' | 'group';
}[];

/** PUT /access/acl — form/query parameters (path segments omitted). */
export type AccessAclPutParams = {
  'auth-id'?: string;
  delete?: '0' | '1';
  digest?: string;
  group?: string;
  path: string;
  propagate?: '0' | '1';
  role:
    | 'Admin'
    | 'Audit'
    | 'NoAccess'
    | 'DatastoreAdmin'
    | 'DatastoreReader'
    | 'DatastoreBackup'
    | 'DatastorePowerUser'
    | 'DatastoreAudit'
    | 'RemoteAudit'
    | 'RemoteAdmin'
    | 'RemoteSyncOperator'
    | 'RemoteSyncPushOperator'
    | 'RemoteDatastorePowerUser'
    | 'RemoteDatastoreAdmin'
    | 'TapeAudit'
    | 'TapeAdmin'
    | 'TapeOperator'
    | 'TapeReader';
};
/** PUT /access/acl — `data` payload after client unwrap. */
export type AccessAclPutReturn = null;

/** GET /access/domains — `data` payload after client unwrap. */
export type AccessDomainsGetReturn = readonly {
  comment?: string;
  default?: boolean | 0 | 1;
  realm: string;
  type: 'pam' | 'pbs' | 'openid' | 'ldap' | 'ad';
}[];

/** POST /access/domains/{realm}/sync — form/query parameters (path segments omitted). */
export type AccessDomainsRealmSyncPostParams = {
  'dry-run'?: '0' | '1';
  'enable-new'?: '0' | '1';
  'remove-vanished'?: string;
};
/** POST /access/domains/{realm}/sync — `data` payload after client unwrap. */
export type AccessDomainsRealmSyncPostReturn = string;

/** GET /access/openid — `data` payload after client unwrap. */
export type AccessOpenidGetReturn = null;

/** POST /access/openid/auth-url — form/query parameters (path segments omitted). */
export type AccessOpenidAuthUrlPostParams = { realm: string; 'redirect-url': string };
/** POST /access/openid/auth-url — `data` payload after client unwrap. */
export type AccessOpenidAuthUrlPostReturn = string;

/** POST /access/openid/login — form/query parameters (path segments omitted). */
export type AccessOpenidLoginPostParams = {
  code: string;
  'http-only'?: '0' | '1';
  'redirect-url': string;
  state: string;
};
/** POST /access/openid/login — `data` payload after client unwrap. */
export type AccessOpenidLoginPostReturn = {
  CSRFPreventionToken: string;
  ticket?: string;
  'ticket-info'?: string;
  username: string;
};

/** PUT /access/password — form/query parameters (path segments omitted). */
export type AccessPasswordPutParams = {
  'confirmation-password'?: string;
  password: string;
  userid: string;
};
/** PUT /access/password — `data` payload after client unwrap. */
export type AccessPasswordPutReturn = null;

/** GET /access/permissions — form/query parameters (path segments omitted). */
export type AccessPermissionsGetParams = { 'auth-id'?: string; path?: string };
/** GET /access/permissions — `data` payload after client unwrap. */
export type AccessPermissionsGetReturn = Record<string, unknown>;

/** GET /access/roles — `data` payload after client unwrap. */
export type AccessRolesGetReturn = readonly {
  comment?: string;
  privs: readonly string[];
  roleid:
    | 'Admin'
    | 'Audit'
    | 'NoAccess'
    | 'DatastoreAdmin'
    | 'DatastoreReader'
    | 'DatastoreBackup'
    | 'DatastorePowerUser'
    | 'DatastoreAudit'
    | 'RemoteAudit'
    | 'RemoteAdmin'
    | 'RemoteSyncOperator'
    | 'RemoteSyncPushOperator'
    | 'RemoteDatastorePowerUser'
    | 'RemoteDatastoreAdmin'
    | 'TapeAudit'
    | 'TapeAdmin'
    | 'TapeOperator'
    | 'TapeReader';
}[];

/** GET /access/tfa — `data` payload after client unwrap. */
export type AccessTfaGetReturn = readonly {
  entries: readonly {
    created: number;
    description: string;
    enable: boolean | 0 | 1;
    id: string;
    type: 'totp' | 'u2f' | 'webauthn' | 'recovery' | 'yubico';
  }[];
  'tfa-locked-until'?: number;
  'totp-locked': boolean | 0 | 1;
  userid: string;
}[];

/** GET /access/tfa/{userid} — `data` payload after client unwrap. */
export type AccessTfaUseridGetReturn = readonly {
  created: number;
  description: string;
  enable: boolean | 0 | 1;
  id: string;
  type: 'totp' | 'u2f' | 'webauthn' | 'recovery' | 'yubico';
}[];

/** POST /access/tfa/{userid} — form/query parameters (path segments omitted). */
export type AccessTfaUseridPostParams = {
  challenge?: string;
  description?: string;
  password?: string;
  totp?: string;
  type: 'totp' | 'u2f' | 'webauthn' | 'recovery' | 'yubico';
  value?: string;
};
/** POST /access/tfa/{userid} — `data` payload after client unwrap. */
export type AccessTfaUseridPostReturn = {
  challenge?: string;
  id?: string;
  recovery: readonly number[];
};

/** GET /access/tfa/{userid}/{id} — `data` payload after client unwrap. */
export type AccessTfaUseridIdGetReturn = null;

/** PUT /access/tfa/{userid}/{id} — form/query parameters (path segments omitted). */
export type AccessTfaUseridIdPutParams = {
  description?: string;
  enable?: '0' | '1';
  password?: string;
};
/** PUT /access/tfa/{userid}/{id} — `data` payload after client unwrap. */
export type AccessTfaUseridIdPutReturn = null;

/** DELETE /access/tfa/{userid}/{id} — form/query parameters (path segments omitted). */
export type AccessTfaUseridIdDeleteParams = { password?: string };
/** DELETE /access/tfa/{userid}/{id} — `data` payload after client unwrap. */
export type AccessTfaUseridIdDeleteReturn = null;

/** POST /access/ticket — form/query parameters (path segments omitted). */
export type AccessTicketPostParams = {
  'http-only'?: '0' | '1';
  password?: string;
  path?: string;
  port?: `${number}`;
  privs?: string;
  'tfa-challenge'?: string;
  username: string;
};
/** POST /access/ticket — `data` payload after client unwrap. */
export type AccessTicketPostReturn = {
  CSRFPreventionToken?: string;
  ticket?: string;
  'ticket-info'?: string;
  username: string;
};

/** DELETE /access/ticket — `data` payload after client unwrap. */
export type AccessTicketDeleteReturn = null;
