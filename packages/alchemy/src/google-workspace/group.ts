/**
 * `GoogleWorkspace.Group` — one Admin SDK Directory group (`admin/directory/v1/groups`).
 *
 * ★ WHY A GROUP IS THE FIRST OBJECT CLASS, AND NOT A USER. The estate's own Cloudflare Access
 *   policies already reference Workspace groups by name ("Schenanigans - Admin", "Schenanigans -
 *   Google" — `docs/zero-trust-access-applications.md` in homeflare-landscape) as the Google IdP
 *   groups an Access rule allows. A group is also the one Directory object with no foreign-key
 *   prerequisite: `email` is the whole identity, the same reasoning `netbox/prefix.ts` gives for
 *   starting with `Prefix` over `Device`.
 *
 * ⛔ USERS ARE OUT OF SCOPE FOR THIS FAMILY. `insertUsers`/`patchUsers`/`updateUsers` all accept a
 *   `password` field on the wire `User` schema — modelling `GoogleWorkspace.User` here would put a
 *   credential-shaped field one keystroke away from becoming a prop, and Alchemy persists props
 *   unencrypted (S25). No stack in this estate declares a Workspace user today (measured
 *   2026-09-24 — see docs/upstream-conformance.md), so there is no house need forcing the
 *   question. `GroupMember` (group-member.ts) references a user by email without ever creating,
 *   reading or storing one.
 *
 * ★ ADOPT-FRIENDLY BY CONSTRUCTION. `groupKey` accepts an email, alias or id; this family always
 *   uses `email` so `fetchLive` binds the live group by the same key a human would type. An
 *   instance that already has `admin@schenanigans.com`'s "Schenanigans - Admin" group is BOUND,
 *   never duplicated, and `attributes` maps the full live row — the exact-as-live half of
 *   `adopt(true)` (resource.ts's own note).
 *
 * ⛔ THIS RESOURCE DOES NOT DELETE BY DEFAULT. `defaultRemovalPolicy: 'retain'` — removing a group
 *   an Access policy still names would break sign-in for everyone that rule allows. `delete` stays
 *   fully implemented; a caller opts in with `.pipe(RemovalPolicy.destroy())`.
 *
 * ⛔ NO CREDENTIAL IS A PROP. `GOOGLE_ACCESS_TOKEN` is read from the environment at call time,
 *   through `@distilled.cloud/google-workspace`'s `CredentialsFromEnv` (resource.ts) — see
 *   credentials.ts for where that token comes from.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as directory from '@distilled.cloud/google-workspace/unstable/admin_directory_v1';
import * as Effect from 'effect/Effect';
import type { GoogleWorkspaceRequirements, GoogleWorkspaceSpec } from './resource.ts';
import { googleWorkspaceHandlers } from './resource.ts';
import { ciEqual, stringArray, text } from './values.ts';

export interface GroupProps {
  /** The group's email address — the primary key for locate, create and update alike. */
  email: string;
  /** Display name. @default the local part of `email` */
  name?: string;
  /** Free text, up to 4,096 characters per the Directory API. */
  description?: string;
}

export interface GroupAttributes {
  email: string;
  name: string;
  description: string;
  groupId: string;
  /** Read-only — direct members, as a decimal string on the wire (Directory's own choice). */
  directMembersCount: string;
  /** Read-only. Aliases outside the primary domain/subdomains; edited only via alias endpoints. */
  nonEditableAliases: string[];
  /** Read-only. Aliases within the account's domains; edited only via alias endpoints. */
  aliases: string[];
  adminCreated: boolean;
}

export interface GoogleWorkspaceGroup extends Resource<
  'GoogleWorkspace.Group',
  GroupProps,
  GroupAttributes,
  never,
  GoogleWorkspaceRequirements
> {}

export const GoogleWorkspaceGroup = Resource<GoogleWorkspaceGroup>('GoogleWorkspace.Group', {
  defaultRemovalPolicy: 'retain',
});

/** Un-declared `name` converges here — deterministic, so an undeclared field never drifts. */
const defaultName = (props: GroupProps): string =>
  props.name ?? props.email.split('@')[0] ?? props.email;

const attributesOf = (live: directory.Group, props: GroupProps): GroupAttributes | undefined => {
  if (live.email === undefined || !ciEqual(live.email, props.email)) return undefined;
  return {
    adminCreated: live.adminCreated === true,
    aliases: stringArray(live.aliases),
    description: text(live.description),
    directMembersCount: text(live.directMembersCount),
    email: live.email,
    groupId: text(live.id),
    name: text(live.name),
    nonEditableAliases: stringArray(live.nonEditableAliases),
  };
};

/** ★ EXPORTED for direct testing with an explicit fake `Credentials` layer — see group.test.ts. */
export const spec: GoogleWorkspaceSpec<
  GroupProps,
  directory.Group,
  GroupAttributes,
  | directory.GetGroupsError
  | directory.InsertGroupsError
  | directory.PatchGroupsError
  | directory.DeleteGroupsError
> = {
  attributes: attributesOf,
  create: (props) =>
    directory.insertGroups({
      body: { description: props.description ?? '', email: props.email, name: defaultName(props) },
    }),
  describe: (props) => `groups/${props.email}`,
  destroy: (_props, live) =>
    directory.deleteGroups({ groupKey: text(live.id) || text(live.email) }),
  fetchLive: (props) =>
    directory
      .getGroups({ groupKey: props.email })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    attributes.description === (props.description ?? '') && attributes.name === defaultName(props),
  update: (props, live) =>
    directory.patchGroups({
      body: { description: props.description ?? '', name: defaultName(props) },
      groupKey: text(live.id) || text(live.email),
    }),
};

export const handlers = googleWorkspaceHandlers(spec);

export const GoogleWorkspaceGroupProvider = () =>
  Provider.effect(GoogleWorkspaceGroup, Effect.succeed(GoogleWorkspaceGroup.Provider.of(handlers)));
