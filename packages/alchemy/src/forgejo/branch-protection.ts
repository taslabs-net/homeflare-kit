/**
 * `Forgejo.BranchProtection` — one rule at `/repos/{owner}/{repo}/branch_protections/{name}`.
 *
 * ★ READ OFF `<estate>/mcp-servers/docs/api/upstream/forgejo.json`: create is POST collection;
 *   read/update/delete use the branch/rule name in the path segment `{name}`. Now through
 *   `@distilled.cloud/forgejo`'s `repository.repoCreateBranchProtection` /
 *   `repoGetBranchProtection` / `repoEditBranchProtection` / `repoDeleteBranchProtection`.
 *
 * ⚠️ `BranchProtection.rule_name` IS A REQUIRED STRING IN THE PACKAGE'S SCHEMA — the deprecated
 *   `branch_name` fallback the hand-rolled client carried is gone; a response missing `rule_name`
 *   now fails the operation's own decode instead of this family silently treating it as absent.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — dropping a protection rule from the stack must not silently
 *   unprotect a branch; opt into `.pipe(RemovalPolicy.destroy())` to DELETE.
 *
 * ⛔ TOKEN NEEDS `write:repository` TO CREATE OR PATCH — get needs `read:repository`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as repository from '@distilled.cloud/forgejo/repository';
import * as Effect from 'effect/Effect';
import { createBranchProtectionForm, editBranchProtectionForm } from './branch-protection-form.ts';
import { type ForgejoRequirements, type ForgejoSpec, forgejoHandlers } from './resource.ts';
import { stringArray } from './values.ts';

export interface BranchProtectionProps {
  owner: string;
  repo: string;
  /** Branch or rule name — path key and `rule_name` on the wire. */
  branchName: string;
  requiredApprovals?: number;
  enablePush?: boolean;
  enableStatusCheck?: boolean;
  requireSignedCommits?: boolean;
  dismissStaleApprovals?: boolean;
  ignoreStaleApprovals?: boolean;
  applyToAdmins?: boolean;
  statusCheckContexts?: string[];
}

export interface BranchProtectionAttributes {
  owner: string;
  repo: string;
  branchName: string;
  requiredApprovals: number;
  enablePush: boolean;
  enableStatusCheck: boolean;
  requireSignedCommits: boolean;
  dismissStaleApprovals: boolean;
  ignoreStaleApprovals: boolean;
  applyToAdmins: boolean;
  statusCheckContexts: string[];
}

export interface ForgejoBranchProtection extends Resource<
  'Forgejo.BranchProtection',
  BranchProtectionProps,
  BranchProtectionAttributes,
  never,
  ForgejoRequirements
> {}

export const ForgejoBranchProtection = Resource<ForgejoBranchProtection>(
  'Forgejo.BranchProtection',
  { defaultRemovalPolicy: 'retain' },
);

/** ★ EXPORTED for direct testing with an explicit fake `Credentials` layer — see repository.ts. */
export const spec: ForgejoSpec<
  BranchProtectionProps,
  repository.BranchProtection,
  BranchProtectionAttributes,
  | repository.RepoCreateBranchProtectionError
  | repository.RepoGetBranchProtectionError
  | repository.RepoEditBranchProtectionError
  | repository.RepoDeleteBranchProtectionError
> = {
  attributes: (live, props) => ({
    applyToAdmins: live.apply_to_admins ?? false,
    branchName: props.branchName,
    dismissStaleApprovals: live.dismiss_stale_approvals ?? false,
    enablePush: live.enable_push ?? true,
    enableStatusCheck: live.enable_status_check ?? false,
    ignoreStaleApprovals: live.ignore_stale_approvals ?? false,
    owner: props.owner,
    repo: props.repo,
    requireSignedCommits: live.require_signed_commits ?? false,
    requiredApprovals: live.required_approvals ?? 0,
    statusCheckContexts: stringArray(live.status_check_contexts ?? []),
  }),
  create: (props) =>
    repository.repoCreateBranchProtection({
      owner: props.owner,
      repo: props.repo,
      ...createBranchProtectionForm(props),
    }),
  destroy: (props) =>
    repository.repoDeleteBranchProtection({
      owner: props.owner,
      repo: props.repo,
      name: props.branchName,
    }),
  fetchLive: (props) =>
    repository
      .repoGetBranchProtection({ owner: props.owner, repo: props.repo, name: props.branchName })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    attributes.requiredApprovals === (props.requiredApprovals ?? 0) &&
    attributes.enablePush === (props.enablePush ?? true) &&
    attributes.enableStatusCheck === (props.enableStatusCheck ?? false) &&
    attributes.requireSignedCommits === (props.requireSignedCommits ?? false) &&
    attributes.dismissStaleApprovals === (props.dismissStaleApprovals ?? false) &&
    attributes.ignoreStaleApprovals === (props.ignoreStaleApprovals ?? false) &&
    attributes.applyToAdmins === (props.applyToAdmins ?? false) &&
    (props.statusCheckContexts === undefined ||
      stringArray(props.statusCheckContexts).join('\0') ===
        attributes.statusCheckContexts.join('\0')),
  update: (props) =>
    repository.repoEditBranchProtection({
      owner: props.owner,
      repo: props.repo,
      name: props.branchName,
      ...editBranchProtectionForm(props),
    }),
};

export const handlers = forgejoHandlers(spec);

export const ForgejoBranchProtectionProvider = () =>
  Provider.effect(
    ForgejoBranchProtection,
    Effect.succeed(ForgejoBranchProtection.Provider.of(handlers)),
  );
