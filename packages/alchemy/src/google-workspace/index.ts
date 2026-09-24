/**
 * Google Workspace providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. These are
 *   the symbols a real stack consumes; the rest of the files are internals a provider needs but a
 *   consumer should not depend on. An `export *` here would publish every helper as API and make
 *   the next refactor a breaking change.
 * ★ `credentials.ts`'s re-exports ARE published, because a stack needs `CredentialsFromEnv` (or
 *   `fromAccessToken` in a test) to build a runtime layer, and `GoogleWorkspaceKeyRef` /
 *   `describeKeyRef` are the documentation seam credential setup is meant to go through.
 */
export {
  type GoogleWorkspaceConfig,
  Credentials,
  CredentialsFromEnv,
  describeKeyRef,
  fromAccessToken,
  GOOGLE_ACCESS_TOKEN_ENV,
  GOOGLE_PROJECT_ID_ENV,
  type GoogleWorkspaceKeyRef,
} from './credentials.ts';
export {
  GoogleWorkspaceDomainAlias,
  GoogleWorkspaceDomainAliasProvider,
  type DomainAliasAttributes,
  type DomainAliasProps,
} from './domain-alias.ts';
export {
  GoogleWorkspaceGroup,
  GoogleWorkspaceGroupProvider,
  type GroupAttributes,
  type GroupProps,
} from './group.ts';
export {
  GoogleWorkspaceGroupMember,
  GoogleWorkspaceGroupMemberProvider,
  type DeliverySettings,
  type GroupMemberAttributes,
  type GroupMemberProps,
  type MemberRole,
} from './group-member.ts';
export {
  GoogleWorkspaceOrgUnit,
  GoogleWorkspaceOrgUnitProvider,
  type OrgUnitAttributes,
  type OrgUnitProps,
} from './org-unit.ts';
export { googleWorkspaceProviders } from './providers.ts';
export {
  googleWorkspaceHandlers,
  googleWorkspaceOperations,
  type GoogleWorkspaceRequirements,
  type GoogleWorkspaceSpec,
} from './resource.ts';
