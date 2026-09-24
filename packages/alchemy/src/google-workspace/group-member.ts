/**
 * `GoogleWorkspace.GroupMember` — one user or group's membership in one Directory group.
 *
 * ★ WHY THIS DOES NOT MODEL A `GoogleWorkspace.User`. `email` here identifies whoever the group
 *   member is (a user's primary email, or another group's), the same way Forgejo's
 *   `TeamMember.username` (team-member.ts) never creates the account it references. The Directory
 *   API needs no user resource to exist in this family for a membership to be declared — see
 *   group.ts's own note on why users are out of scope.
 *
 * ⚠️ UNLIKE `Forgejo.TeamMember`, A MEMBERSHIP HERE IS NOT EXISTENCE-ONLY. `role`
 *   (`OWNER`/`MANAGER`/`MEMBER`) and `deliverySettings` (`ALL_MAIL`/`DIGEST`/`DAILY`/`NONE`/
 *   `DISABLED`) are both mutable in place via `patchMembers` — so this spec declares `update`,
 *   not `upsert`, the same shape `group.ts`/`domain-alias.ts` use.
 *
 * ⛔ GROUP CYCLES ARE THE VENDOR'S TO REFUSE, NOT THIS FAMILY'S. `insertMembers`/`patchMembers`
 *   surface a cycle as `BadRequest`, which this spec's error union already carries un-narrowed —
 *   nothing here guesses at "member is itself an ancestor group".
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as directory from '@distilled.cloud/google-workspace/unstable/admin_directory_v1';
import * as Effect from 'effect/Effect';
import type { GoogleWorkspaceRequirements, GoogleWorkspaceSpec } from './resource.ts';
import { googleWorkspaceHandlers } from './resource.ts';
import { ciEqual, text } from './values.ts';

export type MemberRole = 'OWNER' | 'MANAGER' | 'MEMBER';
export type DeliverySettings = 'ALL_MAIL' | 'DIGEST' | 'DAILY' | 'NONE' | 'DISABLED';

export interface GroupMemberProps {
  /** The group's email, alias or id — same key `Group.email` declares. */
  group: string;
  /** The member's email (a user or another group). Primary key alongside `group`. */
  email: string;
  /** @default 'MEMBER' */
  role?: MemberRole;
  /** @default 'ALL_MAIL' */
  deliverySettings?: DeliverySettings;
}

export interface GroupMemberAttributes {
  group: string;
  email: string;
  memberId: string;
  role: string;
  deliverySettings: string;
  /** Read-only — `ACTIVE` for a normal member, `PENDING` while an invite is outstanding. */
  status: string;
}

export interface GoogleWorkspaceGroupMember extends Resource<
  'GoogleWorkspace.GroupMember',
  GroupMemberProps,
  GroupMemberAttributes,
  never,
  GoogleWorkspaceRequirements
> {}

export const GoogleWorkspaceGroupMember = Resource<GoogleWorkspaceGroupMember>(
  'GoogleWorkspace.GroupMember',
);

const defaultRole = (props: GroupMemberProps): MemberRole => props.role ?? 'MEMBER';
const defaultDelivery = (props: GroupMemberProps): DeliverySettings =>
  props.deliverySettings ?? 'ALL_MAIL';

const attributesOf = (
  live: directory.Member,
  props: GroupMemberProps,
): GroupMemberAttributes | undefined => {
  if (live.email === undefined || !ciEqual(live.email, props.email)) return undefined;
  return {
    deliverySettings: text(live.delivery_settings),
    email: live.email,
    group: props.group,
    memberId: text(live.id),
    role: text(live.role),
    status: text(live.status),
  };
};

/** ★ EXPORTED for direct testing — see group-member.test.ts. */
export const spec: GoogleWorkspaceSpec<
  GroupMemberProps,
  directory.Member,
  GroupMemberAttributes,
  | directory.GetMembersError
  | directory.InsertMembersError
  | directory.PatchMembersError
  | directory.DeleteMembersError
> = {
  attributes: attributesOf,
  create: (props) =>
    directory.insertMembers({
      body: {
        delivery_settings: defaultDelivery(props),
        email: props.email,
        role: defaultRole(props),
      },
      groupKey: props.group,
    }),
  describe: (props) => `groups/${props.group}/members/${props.email}`,
  destroy: (props, live) =>
    directory.deleteMembers({ groupKey: props.group, memberKey: text(live.id) || props.email }),
  fetchLive: (props) =>
    directory
      .getMembers({ groupKey: props.group, memberKey: props.email })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    attributes.role === defaultRole(props) &&
    attributes.deliverySettings === defaultDelivery(props),
  update: (props, live) =>
    directory.patchMembers({
      body: { delivery_settings: defaultDelivery(props), role: defaultRole(props) },
      groupKey: props.group,
      memberKey: text(live.id) || props.email,
    }),
};

export const handlers = googleWorkspaceHandlers(spec);

export const GoogleWorkspaceGroupMemberProvider = () =>
  Provider.effect(
    GoogleWorkspaceGroupMember,
    Effect.succeed(GoogleWorkspaceGroupMember.Provider.of(handlers)),
  );
