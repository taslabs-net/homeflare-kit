/**
 * `Proxmox.Role`'s wire shape: PVE's create/update forms and how a live list row becomes
 * attributes. Split out of role.ts (2026-09-24, the distilled migration) to keep that file
 * under the 250-line cap — the api-token.ts/api-token-form.ts seam.
 */
import type * as access from '@distilled.cloud/proxmox/access';
import type { RoleAttributes, RoleProps } from './role.ts';

export const ROLE_CREATE = 'pve:POST /access/roles';
export const ROLE_UPDATE = 'pve:PUT /access/roles/{roleid}';

/**
 * The only shape two privilege sets may be compared in: sorted, de-duplicated, blanks dropped.
 *
 * ⚠️ THE TRIM AND THE EMPTY FILTER ARE NOT DECORATION. `'A,B,'.split(',')` yields a trailing `''`,
 *   and a hand-written list is quite likely to carry a stray space after a comma. Either one turns
 *   into a phantom member that no live answer can contain, so `matches` would be false on every
 *   plan and the deploy would rewrite the role to exactly what it already was.
 */
export const canonical = (privs: readonly string[]): string[] =>
  [...new Set(privs.map((priv) => priv.trim()).filter((priv) => priv.length > 0))].sort();

export const createForm = (props: RoleProps): access.CreateAccessRoleRequest => ({
  privs: canonical(props.privs).join(','),
  roleid: props.roleid,
});

/**
 * ⚠️ NO `append` FIELD, DELIBERATELY. Sending `append=1` would make every update additive, so a
 *   privilege could be granted from here but never taken away — see role.ts's own header.
 */
export const updateForm = (props: RoleProps): access.PutAccessRoleRequest => ({
  privs: canonical(props.privs).join(','),
  roleid: props.roleid,
});

export const find = (rows: readonly access.ListAccessRolesResponseBodyItem[], roleid: string) =>
  rows.find((row) => row.roleid === roleid);

export const attributesOf = (
  row: access.ListAccessRolesResponseBodyItem,
  props: RoleProps,
): RoleAttributes => ({
  privs: canonical(row.privs === undefined ? [] : row.privs.split(',')),
  roleid: props.roleid,
});

export const matches = (attributes: RoleAttributes, props: RoleProps) =>
  canonical(attributes.privs).join(',') === canonical(props.privs).join(',');
