/**
 * `Proxmox.Group`'s wire shape: PVE's create/update forms, how a live item becomes attributes,
 * and the read itself. Split out of group.ts (2026-09-24) to keep that file under the 250-line
 * cap — the api-token.ts/api-token-form.ts seam, same reasoning as acl.ts/acl-wire.ts.
 */
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import type { GroupAttributes, GroupProps } from './group.ts';
import { UNREADABLE, type Unreadable, readOrUnreadable } from './unreadable-read.ts';
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

const attributesOf = (live: access.GetAccessGroupResponse, props: GroupProps): GroupAttributes => ({
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

/**
 * ★ Default `read` role — nothing widened for this family, see group.ts's header privileges note.
 * ⛔ `{ groupid: props.groupid }`, NEVER THE WHOLE `props` — MEASURED 2026-09-24, the regression
 *   in kit 0.31.1. `GetAccessGroupRequest`'s schema declares only `groupid` (a path label); any
 *   OTHER key on the object passed to `access.getAccessGroup` — `target`, `comment`, every field
 *   this family's own props carry — is treated by distilled's `buildRequest` as an "unknown key"
 *   and JSON-encoded onto the request as a BODY, on every one of these bodyless GETs. A stricter
 *   fetch client than a bare `bun run` of this file refuses a GET carrying any body at all
 *   (`TypeError [ERR_INVALID_ARG_VALUE]: fetch() request with GET/HEAD method cannot have body`),
 *   which `runPveWith` retries across every member and exhausts identically —
 *   `PveClusterExhausted`, then silently folded to "absent" by the old `orElseSucceed`, forcing a
 *   false `update` on every group. `role.ts`'s list call and acl.ts's `listAccessAcl({})` were
 *   never at risk: both are always called with a literal `{}`.
 * ⛔ `live.members === undefined` IS DEFENSIVE, NOT THE ABSENCE SIGNAL — CORRECTED 2026-09-24.
 *   This file previously claimed a missing group answers 200 with `{"data":null}`, unwrapped to
 *   `{}`. MEASURED against the live cluster: `GET /access/groups/{missing}` answers a genuine 500
 *   ("group '…' does not exist"), the SAME shape as user.ts's own measured 500 — there is no
 *   success-path absence signal here at all. The check stays as insurance against a future PVE
 *   release that does answer `{}`, but this function is what actually carries the "not found"
 *   case, as a thrown error — `readGroup` below is the one that folds it.
 */
export const readGroupOrFail = (props: GroupProps) =>
  readOrUnreadable(
    runPve(props.target, 'read', false, access.getAccessGroup({ groupid: props.groupid })),
  ).pipe(
    Effect.map((live) =>
      live === UNREADABLE
        ? UNREADABLE
        : live.members === undefined
          ? undefined
          : attributesOf(live, props),
    ),
  );

/**
 * ⛔ ONLY `GroupNotFound` MEANS ABSENT. The initial distilled transport swap preserved a
 *   catch-all fold because PVE reports missing objects as HTTP 500. SDK PR 265 now types that
 *   measured message, so permission errors, unrelated 500s and exhausted transports propagate
 *   instead of triggering a speculative create (decision 49 follow-up, 2026-09-24).
 * ★ `readGroupOrFail` remains the strict path used for an already-confirmed state row. This
 *   change narrows cold reads/reconcile without changing that existing drift/diff contract.
 */
export const readGroup = (props: GroupProps) =>
  readGroupOrFail(props).pipe(Effect.catchTag('GroupNotFound', () => Effect.succeed(undefined)));

/** `read`/`reconcile` return `Attributes | undefined`; only `diff` tells `UNREADABLE` apart. */
export const dropUnreadable = (live: GroupAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;
