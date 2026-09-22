/**
 * Generated proxmox-backup-server API types for `/config/access/pam` — DO NOT EDIT BY HAND.
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

/** GET /config/access/pam — `data` payload after client unwrap. */
export type ConfigAccessPamGetReturn = {
  comment?: string;
  default?: boolean | 0 | 1;
  realm: string;
  type: 'pam' | 'pbs' | 'openid' | 'ldap' | 'ad';
};

/** PUT /config/access/pam — form/query parameters (path segments omitted). */
export type ConfigAccessPamPutParams = {
  comment?: string;
  default?: '0' | '1';
  delete?: readonly ('comment' | 'default')[];
  digest?: string;
};
/** PUT /config/access/pam — `data` payload after client unwrap. */
export type ConfigAccessPamPutReturn = {
  comment?: string;
  default?: boolean | 0 | 1;
  realm: string;
  type: 'pam' | 'pbs' | 'openid' | 'ldap' | 'ad';
};

/** GET /config/access/pbs — `data` payload after client unwrap. */
export type ConfigAccessPbsGetReturn = {
  comment?: string;
  default?: boolean | 0 | 1;
  realm: string;
  type: 'pam' | 'pbs' | 'openid' | 'ldap' | 'ad';
};

/** PUT /config/access/pbs — form/query parameters (path segments omitted). */
export type ConfigAccessPbsPutParams = {
  comment?: string;
  default?: '0' | '1';
  delete?: readonly ('comment' | 'default')[];
  digest?: string;
};
/** PUT /config/access/pbs — `data` payload after client unwrap. */
export type ConfigAccessPbsPutReturn = {
  comment?: string;
  default?: boolean | 0 | 1;
  realm: string;
  type: 'pam' | 'pbs' | 'openid' | 'ldap' | 'ad';
};

/** GET /config/access/tfa — `data` payload after client unwrap. */
export type ConfigAccessTfaGetReturn = null;

/** GET /config/access/tfa/webauthn — `data` payload after client unwrap. */
export type ConfigAccessTfaWebauthnGetReturn = {
  'allow-subdomains'?: boolean | 0 | 1;
  id: string;
  origin?: string;
  rp: string;
};

/** PUT /config/access/tfa/webauthn — form/query parameters (path segments omitted). */
export type ConfigAccessTfaWebauthnPutParams = {
  'allow-subdomains'?: '0' | '1';
  delete?: readonly ('origin' | 'allow-subdomains')[];
  digest?: string;
  id?: string;
  origin?: string;
  rp?: string;
};
/** PUT /config/access/tfa/webauthn — `data` payload after client unwrap. */
export type ConfigAccessTfaWebauthnPutReturn = null;

/** GET /config/acme — `data` payload after client unwrap. */
export type ConfigAcmeGetReturn = null;

/** GET /config/acme/account — `data` payload after client unwrap. */
export type ConfigAcmeAccountGetReturn = readonly { name: string }[];

/** POST /config/acme/account — form/query parameters (path segments omitted). */
export type ConfigAcmeAccountPostParams = {
  contact: string;
  directory?: string;
  eab_hmac_key?: string;
  eab_kid?: string;
  name?: string;
  tos_url?: string;
};
/** POST /config/acme/account — `data` payload after client unwrap. */
export type ConfigAcmeAccountPostReturn = null;

/** GET /config/acme/account/{name} — `data` payload after client unwrap. */
export type ConfigAcmeAccountNameGetReturn = {
  account: {
    contact: readonly string[];
    externalAccountBinding?: { payload: string; protected: string; signature: string };
    onlyReturnExisting: boolean | 0 | 1;
    orders?: string;
    status: '<invalid>' | 'valid' | 'deactivated' | 'revoked';
    termsOfServiceAgreed?: boolean | 0 | 1;
  } & Record<string, unknown>;
  directory: string;
  location: string;
  tos?: string;
};

/** PUT /config/acme/account/{name} — form/query parameters (path segments omitted). */
export type ConfigAcmeAccountNamePutParams = { contact?: string };
/** PUT /config/acme/account/{name} — `data` payload after client unwrap. */
export type ConfigAcmeAccountNamePutReturn = null;

/** DELETE /config/acme/account/{name} — form/query parameters (path segments omitted). */
export type ConfigAcmeAccountNameDeleteParams = { force?: '0' | '1' };
/** DELETE /config/acme/account/{name} — `data` payload after client unwrap. */
export type ConfigAcmeAccountNameDeleteReturn = null;

/** GET /config/acme/challenge-schema — `data` payload after client unwrap. */
export type ConfigAcmeChallengeSchemaGetReturn = readonly {
  id: string;
  name: string;
  schema: Record<string, unknown>;
  type: string;
}[];

/** GET /config/acme/directories — `data` payload after client unwrap. */
export type ConfigAcmeDirectoriesGetReturn = readonly { name: string; url: string }[];

/** GET /config/acme/plugins — `data` payload after client unwrap. */
export type ConfigAcmePluginsGetReturn = readonly {
  api?: string;
  data?: string;
  disable?: boolean | 0 | 1;
  plugin: string;
  type: string;
  'validation-delay'?: number;
}[];

/** POST /config/acme/plugins — form/query parameters (path segments omitted). */
export type ConfigAcmePluginsPostParams = {
  api: string;
  data: string;
  disable?: '0' | '1';
  id: string;
  type: string;
  'validation-delay'?: `${number}`;
};
/** POST /config/acme/plugins — `data` payload after client unwrap. */
export type ConfigAcmePluginsPostReturn = null;

/** GET /config/acme/plugins/{id} — `data` payload after client unwrap. */
export type ConfigAcmePluginsIdGetReturn = {
  api?: string;
  data?: string;
  disable?: boolean | 0 | 1;
  plugin: string;
  type: string;
  'validation-delay'?: number;
};

/** PUT /config/acme/plugins/{id} — form/query parameters (path segments omitted). */
export type ConfigAcmePluginsIdPutParams = {
  api?: string;
  data?: string;
  delete?: readonly ('disable' | 'validation-delay')[];
  digest?: string;
  disable?: '0' | '1';
  'validation-delay'?: `${number}`;
};
/** PUT /config/acme/plugins/{id} — `data` payload after client unwrap. */
export type ConfigAcmePluginsIdPutReturn = null;

/** DELETE /config/acme/plugins/{id} — `data` payload after client unwrap. */
export type ConfigAcmePluginsIdDeleteReturn = null;

/** GET /config/acme/tos — form/query parameters (path segments omitted). */
export type ConfigAcmeTosGetParams = { directory?: string };
/** GET /config/acme/tos — `data` payload after client unwrap. */
export type ConfigAcmeTosGetReturn = string;

/** GET /config/changer — `data` payload after client unwrap. */
export type ConfigChangerGetReturn = readonly {
  'eject-before-unload'?: boolean | 0 | 1;
  'export-slots'?: string;
  name: string;
  path: string;
}[];

/** POST /config/changer — form/query parameters (path segments omitted). */
export type ConfigChangerPostParams = {
  'eject-before-unload'?: '0' | '1';
  'export-slots'?: string;
  name: string;
  path: string;
};
/** POST /config/changer — `data` payload after client unwrap. */
export type ConfigChangerPostReturn = null;

/** GET /config/changer/{name} — `data` payload after client unwrap. */
export type ConfigChangerNameGetReturn = {
  'eject-before-unload'?: boolean | 0 | 1;
  'export-slots'?: string;
  name: string;
  path: string;
};

/** PUT /config/changer/{name} — form/query parameters (path segments omitted). */
export type ConfigChangerNamePutParams = {
  delete?: readonly ('export-slots' | 'eject-before-unload')[];
  digest?: string;
  'eject-before-unload'?: '0' | '1';
  'export-slots'?: string;
  path?: string;
};
/** PUT /config/changer/{name} — `data` payload after client unwrap. */
export type ConfigChangerNamePutReturn = null;

/** DELETE /config/changer/{name} — `data` payload after client unwrap. */
export type ConfigChangerNameDeleteReturn = null;
