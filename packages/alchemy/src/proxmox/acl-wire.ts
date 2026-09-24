/**
 * `Proxmox.Acl`'s wire shape: PVE's PUT form, identity, and how a live row becomes attributes.
 * Split out of acl.ts (2026-09-24) to keep that file under the 250-line cap once the cries-wolf
 * fix needed real space — the api-token.ts/api-token-form.ts seam, same reasoning: this file
 * answers "what does PVE store", acl.ts answers "when has it changed" and drives the provider.
 */
import type * as access from '@distilled.cloud/proxmox/access';
import { guardForm } from './constraint-guard.ts';
import type { AclAttributes, AclProps } from './acl.ts';

/** ⚠️ PVE normalises ACL paths (collapses repeated slashes, strips the trailing one, adds a leading one). */
export const normalize = (raw: string) => `/${raw.split('/').filter(Boolean).join('/')}`;

/** The write names the subject with a plural key that differs per kind; the read answers singular. */
const SUBJECT_FIELD = { group: 'groups', token: 'tokens', user: 'users' } as const;

/** The vendor endpoint every write and every constraint check runs against. */
const ENDPOINT = 'pve:PUT /access/acl';

/** The tuple PVE keys a grant by, as PUT's fields. */
export const tuple = (props: AclProps): access.PutAccessAclRequest => ({
  path: normalize(props.path),
  roles: props.roleid,
  [SUBJECT_FIELD[props.type]]: props.ugid,
});

/** Create and update are one call: the tuple plus the single mutable field. */
export const bind = (props: AclProps): access.PutAccessAclRequest => ({
  ...tuple(props),
  propagate: props.propagate === false ? '0' : '1',
});

/** `guardForm` wants a plain string-valued form; distilled's request type carries `?` instead. */
const asForm = (body: access.PutAccessAclRequest): Record<string, string> =>
  Object.fromEntries(Object.entries(body).filter((e): e is [string, string] => e[1] !== undefined));

/**
 * ⚠️ ALWAYS PRESENCE-CHECKED. `bind`'s output IS the create form (there is no separate,
 *   narrower update form for this family — see acl.ts's header), so the vendor's
 *   required-parameter check is never wrong to run; the two separate create/update passes the
 *   generic factory ran elsewhere collapse to one call here without losing coverage.
 */
export const guardWrite = (props: AclProps) => guardForm(ENDPOINT, asForm(bind(props)), true);

/** What a change of this string means: not an edit, a different grant. */
export const identity = (grant: Pick<AclAttributes, 'path' | 'roleid' | 'type' | 'ugid'>) =>
  [normalize(grant.path), grant.type, grant.ugid, grant.roleid].join(' ');

const find = (rows: readonly access.ListAccessAclResponseBodyItem[], props: AclProps) =>
  rows.find(
    (row) =>
      row.path === normalize(props.path) &&
      row.type === props.type &&
      row.ugid === props.ugid &&
      row.roleid === props.roleid,
  );

/**
 * ⚠️ PVE answers `propagate` as 1/0 rather than true/false, and OMITS it when it carries the API
 *   default, which is ON. distilled's generated schema types it `unknown` for the same reason.
 */
const propagates = (row: access.ListAccessAclResponseBodyItem) => {
  const value = row.propagate;
  return value === undefined || value === 1 || value === true || value === '1';
};

export const attributesOf = (
  rows: readonly access.ListAccessAclResponseBodyItem[],
  props: AclProps,
): AclAttributes => {
  const row = find(rows, props);
  return {
    bound: row !== undefined,
    path: normalize(props.path),
    propagate: row !== undefined && propagates(row),
    roleid: props.roleid,
    type: props.type,
    ugid: props.ugid,
  };
};

export const matches = (attributes: AclAttributes, props: AclProps) =>
  attributes.bound && attributes.propagate === (props.propagate !== false);
