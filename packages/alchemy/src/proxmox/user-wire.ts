/**
 * `Proxmox.User`'s wire shape: PVE's create/update forms, how a live item becomes attributes,
 * and the read itself. Split out of user.ts (2026-09-24, the distilled migration) to keep that
 * file under the 250-line cap — the api-token.ts/api-token-form.ts seam.
 */
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import type { UserAttributes, UserProps } from './user.ts';
import { UNREADABLE, type Unreadable, readOrUnreadable } from './unreadable-read.ts';
import { bool, text } from './values.ts';

export const USER_CREATE = 'pve:POST /access/users';
export const USER_UPDATE = 'pve:PUT /access/users/{userid}';

/**
 * ⚠️ MORE FORGIVING THAN `lxc.ts`'s `num`, ON PURPOSE, AND DELIBERATELY NOT `values.ts`'s
 *   `int` (a different function of the same name, `Number.parseInt` on a STRING with a
 *   caller-given fallback). PVE's JSON is generated from a Perl schema and an integer field can
 *   arrive as `0` or `"0"` depending on the release and the endpoint; `Number(value ?? 0)`
 *   accepts either without a strict `typeof === 'number'` that would silently fall back for the
 *   string form and report an update `matches` can never settle.
 */
const int = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * An array (what the read returns), a comma string (what older releases and the write side use), or
 * nothing — in; a sorted, deduplicated list out. Both sides of `matches` go through this, which is
 * the only reason the diff ever settles.
 */
const groupSet = (value: unknown): string[] => {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const names = raw.map((group) => text(group).trim()).filter((group) => group !== '');
  return [...new Set(names)].sort();
};

/**
 * ⚠️ THE SHAPE DEPENDS ON WHICH ENDPOINT YOU ASKED. Reading ONE user gives an object keyed by
 *   token name; distilled types it `tokens?: unknown` for the same reason (the item and index
 *   responses disagree, and this provider only ever reads the item). Anything but that shape is
 *   reported as "no tokens" rather than guessed at.
 */
const tokenNames = (value: unknown): string[] =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];

/** Everything mutable, in the form PVE wants. Create adds `userid`; update sends exactly this. */
const shape = (props: UserProps) => ({
  comment: props.comment ?? '',
  email: props.email ?? '',
  enable: props.enable === false ? '0' : '1',
  expire: String(props.expire ?? 0),
  firstname: props.firstname ?? '',
  /**
   * ⚠️ ALWAYS SENT, EVEN EMPTY. Omitting `groups` on a PUT leaves the existing memberships in
   *   place, so a group removed from the declaration would never actually be removed. Same for
   *   `email` and `comment`: the empty string is how PVE is told to clear a field.
   * ⚠️ AND `append` IS DELIBERATELY NOT SET. Its default (0) REPLACES the list; setting it to 1
   *   would turn every reconcile into an add-only merge, which is the same non-settling diff.
   */
  groups: groupSet(props.groups).join(','),
  lastname: props.lastname ?? '',
});

export const createForm = (props: UserProps): access.CreateAccessUserRequest => ({
  ...shape(props),
  userid: props.userid,
});

export const updateForm = (props: UserProps): access.PutAccessUserRequest => ({
  ...shape(props),
  userid: props.userid,
});

const attributesOf = (live: access.GetAccessUserResponse, props: UserProps): UserAttributes => ({
  comment: text(live.comment),
  email: text(live.email),
  /**
   * ⚠️ ABSENT MEANS ENABLED. PVE's schema defaults `enable` to 1 and does not always write the
   *   key back for an enabled account. Reading absence as `false` would report an update on
   *   every plan and then DISABLE the account on the deploy that "fixed" it.
   */
  enable: bool(live.enable, true),
  expire: int(live.expire),
  firstname: text(live.firstname),
  groups: groupSet(live.groups),
  lastname: text(live.lastname),
  tokens: tokenNames(live.tokens),
  /** ⚠️ FROM PROPS: `GET /access/users/{userid}` does not echo the userid back in its data. */
  userid: props.userid,
});

/**
 * ⚠️ `tokens` IS NOT COMPARED, and neither is anything create-only. What is compared is exactly
 *   what a PUT can put back; a field PVE reports but will not accept is drift nobody can fix.
 */
export const matches = (attributes: UserAttributes, props: UserProps) =>
  attributes.comment === (props.comment ?? '') &&
  attributes.email === (props.email ?? '') &&
  attributes.enable === (props.enable !== false) &&
  attributes.expire === (props.expire ?? 0) &&
  attributes.firstname === (props.firstname ?? '') &&
  attributes.lastname === (props.lastname ?? '') &&
  attributes.groups.join(',') === groupSet(props.groups).join(',');

/**
 * ★ Default `read` role for this family — only the write side needs `provision`.
 * ⛔ `{ userid: props.userid }`, NEVER THE WHOLE `props` — MEASURED 2026-09-24, the regression in
 *   kit 0.31.1. `GetAccessUserRequest`'s schema declares only `userid` (a path label); any OTHER
 *   key on the object passed to `access.getAccessUser` — `target`, `comment`, every field this
 *   family's own props carry — is treated by distilled's `buildRequest` as an "unknown key" and
 *   JSON-encoded onto the request as a BODY, on every one of these bodyless GETs. A stricter
 *   fetch client than a bare `bun run` of this file refuses a GET carrying any body at all
 *   (`TypeError [ERR_INVALID_ARG_VALUE]: fetch() request with GET/HEAD method cannot have body`),
 *   which `runPveWith` retries across every member and exhausts identically —
 *   `PveClusterExhausted`, then silently folded to "absent" by the old `orElseSucceed`, forcing a
 *   false `update` on every account.
 */
export const readUserOrFail = (props: UserProps) =>
  readOrUnreadable(
    runPve(props.target, 'read', false, access.getAccessUser({ userid: props.userid })),
  ).pipe(Effect.map((live) => (live === UNREADABLE ? UNREADABLE : attributesOf(live, props))));

/**
 * ⛔ ONLY `UserNotFound` MEANS ABSENT. The initial distilled transport swap preserved a
 *   catch-all fold because PVE reports missing objects as HTTP 500. SDK PR 265 now types that
 *   measured message, so permission errors, unrelated 500s and exhausted transports propagate
 *   instead of triggering a speculative create (decision 49 follow-up, 2026-09-24).
 * ★ `readUserOrFail` remains the strict path used for an already-confirmed state row. This
 *   change narrows cold reads/reconcile without changing that existing drift/diff contract.
 */
export const readUser = (props: UserProps) =>
  readUserOrFail(props).pipe(Effect.catchTag('UserNotFound', () => Effect.succeed(undefined)));

/** `read`/`reconcile` return `Attributes | undefined`; only `diff` tells `UNREADABLE` apart. */
export const dropUnreadable = (live: UserAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;
