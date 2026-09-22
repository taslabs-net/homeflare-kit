/**
 * Generated pve-manager API types for `/access/roles` — DO NOT EDIT BY HAND.
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

/** GET /access/roles — `data` payload after client unwrap. */
export type AccessRolesGetReturn = readonly ({
  privs?: string;
  roleid: string;
  special?: boolean | 0 | 1;
} & Record<string, unknown>)[];

/** POST /access/roles — form/query parameters (path segments omitted). */
export type AccessRolesPostParams = { privs?: string; roleid: string };
/** POST /access/roles — `data` payload after client unwrap. */
export type AccessRolesPostReturn = null;

/** GET /access/roles/{roleid} — `data` payload after client unwrap. */
export type AccessRolesRoleidGetReturn = {
  'Datastore.Allocate'?: boolean | 0 | 1;
  'Datastore.AllocateSpace'?: boolean | 0 | 1;
  'Datastore.AllocateTemplate'?: boolean | 0 | 1;
  'Datastore.Audit'?: boolean | 0 | 1;
  'Group.Allocate'?: boolean | 0 | 1;
  'Mapping.Audit'?: boolean | 0 | 1;
  'Mapping.Modify'?: boolean | 0 | 1;
  'Mapping.Use'?: boolean | 0 | 1;
  'Permissions.Modify'?: boolean | 0 | 1;
  'Pool.Allocate'?: boolean | 0 | 1;
  'Pool.Audit'?: boolean | 0 | 1;
  'Realm.Allocate'?: boolean | 0 | 1;
  'Realm.AllocateUser'?: boolean | 0 | 1;
  'SDN.Allocate'?: boolean | 0 | 1;
  'SDN.Audit'?: boolean | 0 | 1;
  'SDN.Use'?: boolean | 0 | 1;
  'Sys.AccessNetwork'?: boolean | 0 | 1;
  'Sys.Audit'?: boolean | 0 | 1;
  'Sys.Console'?: boolean | 0 | 1;
  'Sys.Incoming'?: boolean | 0 | 1;
  'Sys.Modify'?: boolean | 0 | 1;
  'Sys.PowerMgmt'?: boolean | 0 | 1;
  'Sys.Syslog'?: boolean | 0 | 1;
  'User.Modify'?: boolean | 0 | 1;
  'VM.Allocate'?: boolean | 0 | 1;
  'VM.Audit'?: boolean | 0 | 1;
  'VM.Backup'?: boolean | 0 | 1;
  'VM.Clone'?: boolean | 0 | 1;
  'VM.Config.CDROM'?: boolean | 0 | 1;
  'VM.Config.CPU'?: boolean | 0 | 1;
  'VM.Config.Cloudinit'?: boolean | 0 | 1;
  'VM.Config.Disk'?: boolean | 0 | 1;
  'VM.Config.HWType'?: boolean | 0 | 1;
  'VM.Config.Memory'?: boolean | 0 | 1;
  'VM.Config.Network'?: boolean | 0 | 1;
  'VM.Config.Options'?: boolean | 0 | 1;
  'VM.Console'?: boolean | 0 | 1;
  'VM.GuestAgent.Audit'?: boolean | 0 | 1;
  'VM.GuestAgent.FileRead'?: boolean | 0 | 1;
  'VM.GuestAgent.FileSystemMgmt'?: boolean | 0 | 1;
  'VM.GuestAgent.FileWrite'?: boolean | 0 | 1;
  'VM.GuestAgent.Unrestricted'?: boolean | 0 | 1;
  'VM.Migrate'?: boolean | 0 | 1;
  'VM.PowerMgmt'?: boolean | 0 | 1;
  'VM.Replicate'?: boolean | 0 | 1;
  'VM.Snapshot'?: boolean | 0 | 1;
  'VM.Snapshot.Rollback'?: boolean | 0 | 1;
};

/** PUT /access/roles/{roleid} — form/query parameters (path segments omitted). */
export type AccessRolesRoleidPutParams = { append?: '0' | '1'; privs?: string };
/** PUT /access/roles/{roleid} — `data` payload after client unwrap. */
export type AccessRolesRoleidPutReturn = null;

/** DELETE /access/roles/{roleid} — `data` payload after client unwrap. */
export type AccessRolesRoleidDeleteReturn = null;

/** GET /access/tfa — `data` payload after client unwrap. */
export type AccessTfaGetReturn = readonly ({
  entries: readonly ({
    created: number;
    description: string;
    enable?: boolean | 0 | 1;
    id: string;
    type: 'totp' | 'u2f' | 'webauthn' | 'recovery' | 'yubico';
  } & Record<string, unknown>)[];
  'tfa-locked-until'?: number;
  'totp-locked'?: boolean | 0 | 1;
  userid: string;
} & Record<string, unknown>)[];

/** GET /access/tfa/{userid} — `data` payload after client unwrap. */
export type AccessTfaUseridGetReturn = readonly ({
  created: number;
  description: string;
  enable?: boolean | 0 | 1;
  id: string;
  type: 'totp' | 'u2f' | 'webauthn' | 'recovery' | 'yubico';
} & Record<string, unknown>)[];

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
  id: string;
  recovery?: readonly string[];
} & Record<string, unknown>;

/** GET /access/tfa/{userid}/{id} — `data` payload after client unwrap. */
export type AccessTfaUseridIdGetReturn = {
  created: number;
  description: string;
  enable?: boolean | 0 | 1;
  id: string;
  type: 'totp' | 'u2f' | 'webauthn' | 'recovery' | 'yubico';
} & Record<string, unknown>;

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

/** GET /access/ticket — `data` payload after client unwrap. */
export type AccessTicketGetReturn = null;

/** POST /access/ticket — form/query parameters (path segments omitted). */
export type AccessTicketPostParams = {
  'new-format'?: '0' | '1';
  otp?: string;
  password: string;
  path?: string;
  privs?: string;
  realm?: string;
  'tfa-challenge'?: string;
  username: string;
};
/** POST /access/ticket — `data` payload after client unwrap. */
export type AccessTicketPostReturn = {
  CSRFPreventionToken?: string;
  clustername?: string;
  ticket?: string;
  username: string;
} & Record<string, unknown>;
