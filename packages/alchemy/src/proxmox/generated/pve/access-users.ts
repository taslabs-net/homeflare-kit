/**
 * Generated pve-manager API types for `/access/users` — DO NOT EDIT BY HAND.
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

/** GET /access/users — form/query parameters (path segments omitted). */
export type AccessUsersGetParams = { enabled?: '0' | '1'; full?: '0' | '1' };
/** GET /access/users — `data` payload after client unwrap. */
export type AccessUsersGetReturn = readonly ({
  comment?: string;
  email?: string;
  enable?: boolean | 0 | 1;
  expire?: number;
  firstname?: string;
  groups?: string;
  keys?: string;
  lastname?: string;
  'realm-type'?: string;
  'tfa-locked-until'?: number;
  tokens?: readonly ({
    comment?: string;
    expire?: number;
    privsep?: boolean | 0 | 1;
    tokenid: string;
  } & Record<string, unknown>)[];
  'totp-locked'?: boolean | 0 | 1;
  userid: string;
} & Record<string, unknown>)[];

/** POST /access/users — form/query parameters (path segments omitted). */
export type AccessUsersPostParams = {
  comment?: string;
  email?: string;
  enable?: '0' | '1';
  expire?: `${number}`;
  firstname?: string;
  groups?: string;
  keys?: string;
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
  groups?: readonly string[];
  keys?: string;
  lastname?: string;
  tokens?: unknown;
};

/** PUT /access/users/{userid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridPutParams = {
  append?: '0' | '1';
  comment?: string;
  email?: string;
  enable?: '0' | '1';
  expire?: `${number}`;
  firstname?: string;
  groups?: string;
  keys?: string;
  lastname?: string;
};
/** PUT /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridPutReturn = null;

/** DELETE /access/users/{userid} — `data` payload after client unwrap. */
export type AccessUsersUseridDeleteReturn = null;

/** GET /access/users/{userid}/tfa — form/query parameters (path segments omitted). */
export type AccessUsersUseridTfaGetParams = { multiple?: '0' | '1' };
/** GET /access/users/{userid}/tfa — `data` payload after client unwrap. */
export type AccessUsersUseridTfaGetReturn = {
  realm?: 'oath' | 'yubico';
  types?: readonly ('totp' | 'u2f' | 'yubico' | 'webauthn' | 'recovedry')[];
  user?: 'oath' | 'u2f';
};

/** PUT /access/users/{userid}/unlock-tfa — `data` payload after client unwrap. */
export type AccessUsersUseridUnlockTfaPutReturn = boolean | 0 | 1;

/** GET /access/users/{userid}/token — `data` payload after client unwrap. */
export type AccessUsersUseridTokenGetReturn = readonly ({
  comment?: string;
  expire?: number;
  privsep?: boolean | 0 | 1;
  tokenid: string;
} & Record<string, unknown>)[];

/** GET /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidGetReturn = {
  comment?: string;
  expire?: number;
  privsep?: boolean | 0 | 1;
} & Record<string, unknown>;

/** POST /access/users/{userid}/token/{tokenid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridTokenTokenidPostParams = {
  comment?: string;
  expire?: `${number}`;
  privsep?: '0' | '1';
};
/** POST /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidPostReturn = {
  'full-tokenid': string;
  info: { comment?: string; expire?: number; privsep?: boolean | 0 | 1 } & Record<string, unknown>;
  value: string;
};

/** PUT /access/users/{userid}/token/{tokenid} — form/query parameters (path segments omitted). */
export type AccessUsersUseridTokenTokenidPutParams = {
  comment?: string;
  delete?: string;
  expire?: `${number}`;
  privsep?: '0' | '1';
  regenerate?: '0' | '1';
};
/** PUT /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidPutReturn = {
  comment?: string;
  expire?: number;
  'full-tokenid'?: string;
  privsep?: boolean | 0 | 1;
  value?: string;
} & Record<string, unknown>;

/** DELETE /access/users/{userid}/token/{tokenid} — `data` payload after client unwrap. */
export type AccessUsersUseridTokenTokenidDeleteReturn = null;

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
