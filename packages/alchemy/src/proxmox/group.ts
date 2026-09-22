/**
 * `Proxmox.Group` — a PVE group: a name, a comment, and the set of users PVE hangs off it.
 *
 * ★ DECLARING `hf-mint` IS THE WHOLE POINT OF THIS FAMILY. `mint@pve` holds the `MintTokens` role
 *   ON THE PATH `/access/groups/hf-mint` — measured from `GET /access/acl`, 2026-09-13 — which is
 *   what confines the OpenBao proxmox engine to minting inside that one group. The group is the
 *   fence around the credential every other resource in this package runs on, and until now it was
 *   something a human typed on a node once. `user.ts` calls that account the branch it sits on;
 *   this is the branch's other end.
 *
 * ⛔ MEMBERSHIP IS NOT SETTABLE HERE, SO IT IS REPORTED AND NEVER DIFFED. Measured from the
 *   cluster's own schema: `POST /access/groups` and `PUT /access/groups/{groupid}` each accept
 *   EXACTLY `groupid` and `comment`, both with `additionalProperties: 0`. There is no members
 *   parameter to send. Membership is written from the other side — the `groups` field on each
 *   USER, which `user.ts` already owns — so `members` below is an attribute, out of `matches`,
 *   exactly like `pool.members` and `user.tokens`. Declared here it would be a diff that no write
 *   in this file could ever settle.
 *
 * ⛔ THE INDEX AND THE ITEM DISAGREE ABOUT BOTH THE NAME AND THE TYPE, and this file reads only the
 *   item. MEASURED against node-b, 2026-09-13:
 *     GET /access/groups         -> [{"groupid":"hf-mint","comment":"…",
 *                                     "users":"hf-provision@pve,hf-read@pve"}, …]
 *     GET /access/groups/hf-mint -> {"comment":"…","members":["hf-provision@pve","hf-read@pve"]}
 *   The index says `users` and hands back a COMMA STRING; the item says `members` and hands back an
 *   ARRAY. A reader that looked for `users` on the item path would find nothing, report an empty
 *   group, and quietly show a delete as harmless.
 *
 * ⛔ AND THE ITEM'S ORDER IS NOT STABLE BETWEEN TWO CONSECUTIVE CALLS. MEASURED, seconds apart, on
 *   the same endpoint:
 *     ["root@pam","alice@pve","alice@pam","alice@example.com@corp"]
 *     ["alice@pam","alice@pve","alice@example.com@corp","root@pam"]
 *   `read_group` builds it as `[keys %{ $data->{users} }]` — a bare Perl hash key list, whose order
 *   is randomised per process — while the INDEX sorts (`join(',', sort keys …)`). So the array is
 *   sorted on the way into `attributes` as well as being kept out of `matches`: unsorted, Alchemy's
 *   stored state would churn on every read even with nothing to diff.
 *
 * ⚠️ `groupid` IS NOT ECHOED BY THE ITEM READ. Its return schema is `additionalProperties: 0` over
 *   exactly `comment` and `members`, so the id comes from props — the same arrangement, and the
 *   same reason, as `user.ts`.
 *
 * ★ PRIVILEGES: NOTHING HAD TO BE WIDENED, WHICH MAKES THIS THE FIRST FAMILY HERE THAT COST
 *   NOTHING. Measured with `pveum user permissions`, 2026-09-13:
 *     · item GET checks `['perm','/access/groups',['Sys.Audit','Group.Allocate'], any => 1]`, and
 *       `hf-read@pve` already holds `Sys.Audit` there (propagated from `/` by `PVEAuditor`).
 *       So `readRole` is left at the default `read` — unlike storage/sdn-zone/sdn-vnet, whose ITEM
 *       reads PVE gates on an allocate privilege. See the ⛔ on `readRole` in `resource.ts`.
 *     · POST, PUT and DELETE each check `Group.Allocate` on `/access/groups`, and
 *       `hf-provision@pve` holds it via the provision role (`PROVISION_PRIVILEGES`).
 *
 * ⛔ `retain` BY DEFAULT, BECAUSE DELETING A GROUP DESTROYS TWO THINGS THIS FILE CANNOT PUT BACK.
 *   Measured in `PVE::AccessControl` on the node:
 *     · The member list IS the group. `user.cfg` stores it on the GROUP line (`group:<id>:<users>:
 *       <comment>:`) and DERIVES each user's `groups` map from it at parse time. Deleting the group
 *       deletes the list, and this resource has no `members` prop to restore it from.
 *     · `delete_group_acl` then walks the whole ACL tree and drops every grant where the group is
 *       the SUBJECT. On this cluster that is `admins -> Administrator on /` and
 *       `automation -> PVEAuditor on /`: whole populations of access, gone in one call, with no
 *       confirmation and nothing in the plan to suggest it.
 *   `delete` is FULLY IMPLEMENTED — `DELETE /access/groups/{groupid}` exists, unlike the ACL
 *   family's — so `.pipe(RemovalPolicy.destroy())` really removes the group. See the ★ in
 *   `resource.ts` for why the policy is a guard rather than a stubbed-out operation.
 *
 * ⛔ NO SECRET REACHES STATE. A group holds a comment and a list of userids; there is no password,
 *   no token and no key anywhere on these endpoints. `user.ts`'s ⛔ about unencrypted state applies
 *   to this package, and this family simply has nothing to trip it.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { csv, text } from './values.ts';

export interface GroupProps extends WithTarget {
  /**
   * PVE's primary key for a group.
   *
   * ⚠️ THERE IS NO RENAME, AND THE FAILURE IS WORSE HERE THAN FOR A ROLE. Editing this makes `path`
   *   point at a different group, which reads as absent and is created empty — while the old group
   *   keeps its members and its ACL grants with nobody managing it. Two groups then both look
   *   right in the UI and only one of them grants anything.
   */
  groupid: string;
  /** Free text shown in the UI — the only mutable field a group has. See `storedComment` below. */
  comment?: string;
}

export interface GroupAttributes {
  groupid: string;
  comment: string;
  /**
   * Who is in the group, sorted — reported so a plan can say what a delete would strip, never
   * compared, because this endpoint cannot set it. See the two ⛔s in the header.
   */
  members: string[];
}

export interface ProxmoxGroup extends Resource<
  'Proxmox.Group',
  GroupProps,
  GroupAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a delete takes the membership and the group's grants. See the header. */
export const ProxmoxGroup = Resource<ProxmoxGroup>('Proxmox.Group', {
  defaultRemovalPolicy: 'retain',
});

/**
 * The comment PVE will actually END UP HOLDING for a given declaration.
 *
 * ⛔ PVE CANNOT STORE THE COMMENT `'0'`, AND A PROVIDER THAT DOES NOT MODEL THAT DIFFS FOREVER.
 *   Three places in the shipped Perl test the comment for TRUTH rather than for definedness, and
 *   in Perl the one-character string `'0'` is false:
 *     `create_group`:      `$group->{comment} = $param->{comment} if $param->{comment};`
 *     `write_user_config`: `my $comment = $d->{comment} ? encode_text($d->{comment}) : '';`
 *     the config parser:   `$cfg->{groups}->{$g}->{comment} = decode_text($comment) if $comment;`
 *   So a declared `comment: '0'` is accepted by the API, dropped on the way to `user.cfg`, and read
 *   back as absent. Left alone, `matches` would be false on every plan and every deploy would
 *   rewrite the same value into the same hole. Normalising BOTH the comparison and the form is how
 *   `values.ts` already treats `''` as the absence of a boolean rather than as `false`.
 *   ⚠️ MEASURED IN THE SOURCE ON node-b, NOT ON THE WIRE — writing `'0'` to the cluster to watch it
 *     vanish would have been a write, and this agent had read access only.
 *   ⚠️ `pool.ts` HAS THE SAME LATENT HOLE — `pool:$pool:$comment:…` is written by that same
 *     truthiness test and is not guarded. Not fixed from here; flagged so it is fixed on purpose.
 *
 * ⚠️ EVERY OTHER COMMENT ROUND-TRIPS EXACTLY, colons and newlines included: `write_user_config`
 *   runs it through `encode_text` and the parser through `decode_text`, so the field separator in
 *   `user.cfg` cannot be smuggled in.
 */
const storedComment = (comment: string | undefined) => {
  const value = comment ?? '';
  return value === '0' ? '' : value;
};

/**
 * The item read's `members` array, sorted into something two plans can agree on.
 *
 * ⚠️ `csv` IS REUSED RATHER THAN RE-IMPLEMENTED, AND ITS OWN ⚠️ IS EXACTLY THIS CASE: a list PVE
 *   does not promise to give back in the order it was handed. Going out through the joined form
 *   and back is the price of that reuse, and cheaper than a fourth hand-rolled sorter.
 * ⚠️ THE ARRAY ONLY — THE COMMA STRING IS NOT ACCEPTED HERE, ON PURPOSE. That spelling belongs to
 *   the INDEX (`users`), which this provider never reads, so a branch for it would be a guess at a
 *   shape that cannot arrive. `user.ts` refuses the same guess for `tokens` and for the same
 *   reason: a wrong guess on a reported-only field surfaces in a plan as a phantom membership.
 * ⚠️ NO DEDUPLICATION, UNLIKE `user.ts`'s `groupSet`. These names are Perl HASH KEYS —
 *   `[keys %{ $data->{users} }]` — so a duplicate is not representable. `user.groups` needs the
 *   dedupe because its value also arrives from a hand-written prop; this one never does.
 */
const memberList = (live: unknown): string[] => {
  const joined = csv((Array.isArray(live) ? live : []).map((member: unknown) => text(member)));
  return joined === '' ? [] : joined.split(',');
};

const handlers = pveHandlers<GroupProps, GroupAttributes>({
  attributes: (live, props) => ({
    /**
     * ⚠️ ABSENT IS EMPTY, NOT MISSING. `read_group` sets `comment` only `if defined(…)`, so a group
     *   without one answers `{"members":[…]}` and nothing else. THAT ONE IS READ OFF THE HANDLER'S
     *   SOURCE, not off the wire — every group on this cluster happens to carry a comment, so the
     *   commentless shape was not there to measure. The empty-MEMBERS shape WAS measured —
     *   `automation` answers `{"comment":"…","members":[]}`. `''` is what an undeclared
     *   `comment` prop normalises to, so the two sides meet either way.
     */
    comment: text(live['comment']),
    /** ⚠️ FROM PROPS: the item read's schema is `additionalProperties: 0` over comment/members. */
    groupid: props.groupid,
    members: memberList(live['members']),
  }),
  collection: () => 'access/groups',
  createForm: (props) => ({ comment: storedComment(props.comment), groupid: props.groupid }),
  /**
   * ⚠️ `members` IS NOT COMPARED, AND NOTHING ELSE IS LEFT TO COMPARE. `comment` is the only field
   *   a PUT here accepts, so it is the only field whose drift this provider can repair — the rule
   *   `resource.ts` states once in the ⛔ on adoption: a field deliberately out of `matches` is a
   *   field this resource does not manage.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pve:POST /access/groups', update: 'pve:PUT /access/groups/{groupid}' },
  matches: (attributes, props) => attributes.comment === storedComment(props.comment),
  path: (props) => `access/groups/${props.groupid}`,
  /**
   * ⚠️ ALWAYS SENT, EVEN EMPTY — that is how a comment is CLEARED. `update_group` assigns
   *   `if defined($param->{comment})`, so an omitted field leaves the old text in place and a
   *   declaration that dropped its comment would report an update the update could not settle. The
   *   empty string then falls out of `user.cfg` on the truthiness test above and reads back as
   *   `''`, which is what the props side normalises to. The loop closes.
   */
  updateForm: (props) => ({ comment: storedComment(props.comment) }),
});

/**
 * ⛔ THE EMPTY `list` IS INHERITED FROM `pveHandlers` AND IT MATTERS HERE. `GET /access/groups`
 *   answers with every group on the cluster — on this one that is `admins`, which grants
 *   `Administrator` on `/` to every human who logs in. Handing it to Alchemy would invite adoption,
 *   and therefore one day a delete that takes the whole admin group's access with it. Adoption
 *   stays an explicit act, here as everywhere else in this package.
 */
export const ProxmoxGroupProvider = () =>
  Provider.effect(ProxmoxGroup, Effect.succeed(ProxmoxGroup.Provider.of(handlers)));
