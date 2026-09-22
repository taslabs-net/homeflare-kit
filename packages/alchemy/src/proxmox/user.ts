/**
 * `Proxmox.User` — a PVE account. The identity every other resource in this package borrows.
 *
 * ★ THIS IS THE ONE OBJECT THAT CAN CUT THE BRANCH IT SITS ON. The user the credential mount vends
 *   tokens for, and the group whose members are allowed to mint, are what `src/credentials.ts`
 *   ultimately asks OpenBao for. A cluster rebuilt without them cannot plan ANY resource here —
 *   including the plan that would recreate them, which needs a credential to run. So this resource
 *   is drift repair for an account that already exists (comment, email, enable, expire, groups),
 *   not a bootstrap: the first mint user is made on a node with `pveum user add`, by a human, once.
 *
 * ⛔ THERE IS NO `password` PROP, AND ADDING ONE WOULD BE A LEAK RATHER THAN A FEATURE. Alchemy
 *   writes resource state WITHOUT encryption — see the ⛔ in `credentials.ts` — so a password prop
 *   would sit in clear in whatever database the stack points `state` at, and in every backup of it.
 *   It is also unnecessary: `password` is accepted only by the CREATE call, changing one afterwards
 *   is `PUT /access/password` (a different endpoint, a different privilege), and an account in a
 *   realm such as `@pam`, `@ldap` or `@openid` has no PVE-side password at all — the realm holds
 *   it. Out of scope by design. `keys` (TFA) is omitted for the same reason.
 *
 * ⚠️ `groups` COMES BACK AS AN ARRAY AND GOES OUT AS A COMMA STRING, and the asymmetry is the whole
 *   trap. GET answers `["a","b"]`, POST/PUT want `a,b`, and PVE returns the list in ITS order, not
 *   the declared one. Compared naively, `matches` reads ['b','a'] against 'a,b' and every plan for
 *   the rest of time says "1 to update". Both sides are normalised to a sorted, deduplicated set
 *   below. Joining is a safe comparison precisely because a group id cannot contain a comma — the
 *   wire format is comma-separated, so PVE refuses one.
 *
 * ⚠️ `tokens` IS NESTED AND IS NOT SETTABLE THROUGH THIS ENDPOINT. The read hands back a map of the
 *   account's API tokens; `PUT /access/users/{userid}` has no parameter for them, because they are
 *   their own objects under `.../token/{tokenid}`. So they are reported as an attribute — a plan
 *   can then say what a delete would take with it — and kept OUT of `matches`, exactly like
 *   `pool.members`. Reported, never declared.
 *
 * ⚠️ RECONCILE NEEDS PRIVILEGES A GUEST-ONLY ROLE DOES NOT HOLD, so they are stated rather than met
 *   as a 403 in the middle of a deploy (pool.ts records how that went the last time).
 *   `PROVISION_PRIVILEGES` (provision-baseline.ts) carries every one of them:
 *     · `Realm.AllocateUser` on `/access/realm/<realm>` — create and delete.
 *     · `User.Modify` on `/access/groups`, and on `/access/groups/<group>` for EVERY group named in
 *       `groups` — create, update and delete. PVE checks the groups you are granting, not just the
 *       user, so a role wide enough to edit the account can still be refused for one group in the
 *       list.
 *     · `Sys.Audit` (or `User.Modify`) for the read, which the `read` role's auditor already has.
 *   `Permissions.Modify` is NOT on this list: that governs ACL entries, which are a different PVE
 *   object and would be a different resource here.
 *
 * ⚠️ A MISSING USER IS A 500, NOT A 404 — "no such user ('x@pve')" — and the factory turns any
 *   failed read into "absent". A 403 therefore also reads as absent, and the honest error arrives
 *   one step later, from the create: "Permission check failed (/access/groups, User.Modify)". That
 *   string is the one to grep for when a plan insists on creating an account that plainly exists.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { bool } from './values.ts';

export interface UserProps extends WithTarget {
  /**
   * ⛔ REALM-QUALIFIED, ALWAYS: `someone@pve`, `someone@pam`. The realm is part of PVE's primary
   *   key, and a bare name is refused with "value does not look like a valid user id".
   *
   * ⚠️ PVE HAS NO RENAME. Editing this prop makes the path point at a DIFFERENT account, which
   *   reads as absent and is then created — while the old one stays on the cluster with its tokens
   *   and its ACL entries. Renaming is a delete and a create, and should be declared as one.
   */
  userid: string;
  /** Free text shown in the UI. */
  comment?: string;
  /** PVE accepts the empty string here; that is how an address is cleared. */
  email?: string;
  /** Default true, matching PVE's own `enable=1`. False disables login without deleting anything. */
  enable?: boolean;
  /** Seconds since the epoch. 0 — the default — means the account never expires. */
  expire?: number;
  /** Group memberships. Order and duplicates carry no meaning — see the ⚠️ in the header. */
  groups?: string[];
  firstname?: string;
  lastname?: string;
}

export interface UserAttributes {
  userid: string;
  comment: string;
  email: string;
  enable: boolean;
  expire: number;
  /** Normalised: sorted, deduplicated, whatever shape the cluster used on the wire. */
  groups: string[];
  firstname: string;
  lastname: string;
  /**
   * API token names this account owns. Reported so a plan can show what a delete would revoke;
   * never compared, because this endpoint cannot set them.
   */
  tokens: string[];
}

export interface ProxmoxUser extends Resource<
  'Proxmox.User',
  UserProps,
  UserAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxUser = Resource<ProxmoxUser>('Proxmox.User');

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * ⚠️ MORE FORGIVING THAN `lxc.ts`'s `num`, ON PURPOSE. PVE's JSON is generated from a Perl schema
 *   and an integer field can arrive as `0` or as `"0"` depending on the release and the endpoint. A
 *   strict `typeof === 'number'` would silently fall back to 0 for the string form, so a declared
 *   `expire` would never equal the live one and the plan would report an update it cannot settle.
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
  const names = raw.map((group) => str(group).trim()).filter((group) => group !== '');
  return [...new Set(names)].sort();
};

/**
 * ⚠️ THE SHAPE DEPENDS ON WHICH ENDPOINT YOU ASKED. Reading ONE user gives an object keyed by token
 *   name; the collection read gives an array of records. This provider only ever reads the single
 *   user path, so the map is what arrives — anything else is reported as "no tokens" rather than
 *   guessed at, because a wrong guess here would show up as a phantom revocation in a plan.
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
   *   place, so a group removed from the declaration would never actually be removed — and
   *   `matches` would keep reporting an update that the update cannot fix. Same for `email` and
   *   `comment`: the empty string is how PVE is told to clear a field.
   * ⚠️ AND `append` IS DELIBERATELY NOT SET. Its default (0) REPLACES the list; setting it to 1
   *   would turn every reconcile into an add-only merge, which is the same non-settling diff.
   */
  groups: groupSet(props.groups).join(','),
  lastname: props.lastname ?? '',
});

const handlers = pveHandlers<UserProps, UserAttributes>({
  attributes: (live, props) => ({
    comment: str(live['comment']),
    email: str(live['email']),
    /**
     * ⚠️ ABSENT MEANS ENABLED. PVE's schema defaults `enable` to 1 and does not always write the
     *   key back for an enabled account. Reading absence as `false` would report an update on every
     *   plan and then DISABLE the account on the deploy that "fixed" it.
     */
    enable: bool(live['enable'], true),
    expire: int(live['expire']),
    firstname: str(live['firstname']),
    groups: groupSet(live['groups']),
    lastname: str(live['lastname']),
    tokens: tokenNames(live['tokens']),
    /** ⚠️ FROM PROPS: `GET /access/users/{userid}` does not echo the userid back in its data. */
    userid: props.userid,
  }),
  collection: () => 'access/users',
  createForm: (props) => ({ ...shape(props), userid: props.userid }),
  /**
   * ⚠️ `tokens` IS NOT COMPARED, and neither is anything create-only. What is compared is exactly
   *   what a PUT can put back; a field that PVE reports but will not accept is drift nobody can
   *   fix, and diffing it would report an update on every plan forever.
   */
  matches: (attributes, props) =>
    attributes.comment === (props.comment ?? '') &&
    attributes.email === (props.email ?? '') &&
    attributes.enable === (props.enable !== false) &&
    attributes.expire === (props.expire ?? 0) &&
    attributes.firstname === (props.firstname ?? '') &&
    attributes.lastname === (props.lastname ?? '') &&
    attributes.groups.join(',') === groupSet(props.groups).join(','),
  path: (props) => `access/users/${props.userid}`,
  updateForm: shape,
});

/**
* ⛔ EMPTY, AND MORE POINTEDLY SO HERE THAN ANYWHERE ELSE. `GET /access/users` answers with
*   every account on the cluster: `root@pam`, every human who logs in, every service
*   identity someone made years ago. Handing that list to Alchemy would invite it to adopt
*   — and therefore one day DELETE — people. Adoption is an explicit act.
 
 *
* ⛔ DELETING A USER TAKES ITS API TOKENS AND ITS ACL ENTRIES WITH IT, in one call and
*   without a confirmation. For the identity a credential mount vends from, that revokes
*   every outstanding lease at once and every plan in this package stops working — this one
*   included. PVE refuses only for `root@pam`; for everyone else it simply obeys.
 
 */
export const ProxmoxUserProvider = () =>
  Provider.effect(ProxmoxUser, Effect.succeed(ProxmoxUser.Provider.of(handlers)));
