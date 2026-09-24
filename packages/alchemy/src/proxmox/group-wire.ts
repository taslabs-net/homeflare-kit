/**
 * `Proxmox.Group`'s wire shape: PVE's create/update forms and how a live item becomes
 * attributes. Split out of group.ts (2026-09-24) to keep that file under the 250-line cap —
 * the api-token.ts/api-token-form.ts seam, same reasoning as acl.ts/acl-wire.ts.
 */
import type * as access from '@distilled.cloud/proxmox/access';
import type { GroupAttributes, GroupProps } from './group.ts';
import { csv, text } from './values.ts';

export const GROUP_CREATE = 'pve:POST /access/groups';
export const GROUP_UPDATE = 'pve:PUT /access/groups/{groupid}';

/**
 * The comment PVE will actually END UP HOLDING for a given declaration.
 *
 * ⛔ PVE CANNOT STORE THE COMMENT `'0'`, AND A PROVIDER THAT DOES NOT MODEL THAT DIFFS FOREVER.
 *   `create_group`/`write_user_config`/the config parser all test the comment for TRUTH, and in
 *   Perl the one-character string `'0'` is false. So a declared `comment: '0'` is accepted by the
 *   API, dropped on the way to `user.cfg`, and read back as absent. Normalising BOTH sides is how
 *   `values.ts` already treats `''` as the absence of a boolean rather than as `false`.
 */
export const storedComment = (comment: string | undefined) => {
  const value = comment ?? '';
  return value === '0' ? '' : value;
};

/** The item read's `members` array, sorted into something two plans can agree on — group.ts's header. */
const memberList = (live: readonly string[]): string[] => {
  const joined = csv(live.map((member) => text(member)));
  return joined === '' ? [] : joined.split(',');
};

export const createForm = (props: GroupProps): access.CreateAccessGroupRequest => ({
  comment: storedComment(props.comment),
  groupid: props.groupid,
});

/** ⚠️ ALWAYS SENT, EVEN EMPTY — that is how a comment is CLEARED (see group.ts's own header). */
export const updateForm = (props: GroupProps): access.PutAccessGroupRequest => ({
  comment: storedComment(props.comment),
  groupid: props.groupid,
});

export const attributesOf = (
  live: access.GetAccessGroupResponse,
  props: GroupProps,
): GroupAttributes => ({
  /**
   * ⚠️ ABSENT IS EMPTY, NOT MISSING — `read_group` sets `comment` only `if defined(…)`. distilled
   *   types it `comment?: string`, so `text()`'s `''` fallback meets the same normalisation.
   */
  comment: text(live.comment),
  /** ⚠️ FROM PROPS — the item read never echoes the id back. */
  groupid: props.groupid,
  members: memberList(live.members),
});

/**
 * ⚠️ `members` IS NOT COMPARED, AND NOTHING ELSE IS LEFT TO COMPARE. `comment` is the only field
 *   a PUT here accepts, so it is the only field whose drift this provider can repair.
 */
export const matches = (attributes: GroupAttributes, props: GroupProps) =>
  attributes.comment === storedComment(props.comment);
