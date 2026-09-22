/**
 * Generated proxmox-backup-server API types for `/access/users` — DO NOT EDIT BY HAND.
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

/** GET /access/users — form/query parameters (path segments omitted). */
export type AccessUsersGetParams = { include_tokens?: '0' | '1' };
/** GET /access/users — `data` payload after client unwrap. */
export type AccessUsersGetReturn = readonly {
  comment?: string;
  email?: string;
  enable?: boolean | 0 | 1;
  expire?: number;
  firstname?: string;
  lastname?: string;
  'tfa-locked-until'?: number;
  tokens?: readonly {
    comment?: string;
    enable?: boolean | 0 | 1;
    expire?: number;
    tokenid: string;
  }[];
  'totp-locked'?: boolean | 0 | 1;
  userid: string;
}[];

/** POST /access/users — form/query parameters (path segments omitted). */
export type AccessUsersPostParams = {
  comment?: string;
  email?: string;
  enable?: '0' | '1';
  expire?: `${number}`;
  firstname?: string;
  lastname?: string;
  password?: string;
  userid: string;
};
/** POST /access/users — `data` payload after client unwrap. */
export type AccessUsersPostReturn = null;

/** GET /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridGetReturn = {
  comment?: string;
  email?: string;
  enable?: boolean | 0 | 1;
  expire?: number;
  firstname?: string;
  lastname?: string;
  userid: string;
};

/** PUT /access/users/{userid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridPutParams = {
  comment?: string;
  delete?: readonly ('comment' | 'firstname' | 'lastname' | 'email')[];
  digest?: string;
  email?: string;
  enable?: '0' | '1';
  expire?: `${number}`;
  firstname?: string;
  lastname?: string;
  password?: string;
};
/** PUT /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridPutReturn = null;

/** DELETE /access/users/{userid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridDeleteParams = { digest?: string };
/** DELETE /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridDeleteReturn = null;

/** GET /access/users/{userid}/token — `data` payload after client unwrap. */
export type AccessUsersUseridTokenGetReturn = readonly {
  comment?: string;
  enable?: boolean | 0 | 1;
  expire?: number;
  'token-name': string;
  tokenid: string;
}[];

/** GET /access/users/{userid}/token/{token-name} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenNameGetReturn = {
  comment?: string;
  enable?: boolean | 0 | 1;
  expire?: number;
  tokenid: string;
};

/** POST /access/users/{userid}/token/{token-name} — form/query parameters (path segments omitted). */
export type AccessUsersUseridTokenTokenNamePostParams = {
  comment?: string;
  digest?: string;
  enable?: '0' | '1';
  expire?: `${number}`;
};
/** POST /access/users/{userid}/token/{token-name} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenNamePostReturn = { tokenid: string; value: string };

/** PUT /access/users/{userid}/token/{token-name} — form/query parameters (path segments omitted). */
export type AccessUsersUseridTokenTokenNamePutParams = {
  comment?: string;
  delete?: readonly ('comment')[];
  digest?: string;
  enable?: '0' | '1';
  expire?: `${number}`;
  regenerate?: '0' | '1';
};
/** PUT /access/users/{userid}/token/{token-name} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenNamePutReturn = { secret?: string };

/** DELETE /access/users/{userid}/token/{token-name} — form/query parameters (path segments omitted). */
export type AccessUsersUseridTokenTokenNameDeleteParams = { digest?: string };
/** DELETE /access/users/{userid}/token/{token-name} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenNameDeleteReturn = null;

/** PUT /access/users/{userid}/unlock-tfa — `data` payload after client unwrap. */
export type AccessUsersUseridUnlockTfaPutReturn = boolean | 0 | 1;

/** POST /access/vncticket — form/query parameters (path segments omitted). */
export type AccessVncticketPostParams = {
  authid: string;
  path: string;
  port?: `${number}`;
  privs: string;
  vncticket: string;
};
/** POST /access/vncticket — `data` payload after client unwrap. */
export type AccessVncticketPostReturn = null;
