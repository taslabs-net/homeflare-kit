/**
 * `Forgejo.BranchProtection` — one rule at `/repos/{owner}/{repo}/branch_protections/{name}`.
 *
 * ★ READ OFF `house/mcp-servers/docs/api/upstream/forgejo.json`: create is POST collection;
 *   read/update/delete use the branch/rule name in the path segment `{name}`. Response carries
 *   `rule_name` (preferred) and deprecated `branch_name`.
 *
 * ⛔ `defaultRemovalPolicy: 'retain'` — dropping a protection rule from the stack must not silently
 *   unprotect a branch; opt into `.pipe(RemovalPolicy.destroy())` to DELETE.
 *
 * ⛔ TOKEN NEEDS `write:repository` TO CREATE OR PATCH — get needs `read:repository`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { branchProtectionForm } from './branch-protection-form.ts';
import { type ForgejoRequirements, forgejoHandlers } from './resource.ts';
import { bool, int, stringArray, text } from './values.ts';

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

const handlers = forgejoHandlers<BranchProtectionProps, BranchProtectionAttributes>({
  attributes: (live, props) => {
    const ruleName = text(live['rule_name'], text(live['branch_name']));
    if (ruleName === '') return undefined;
    return {
      applyToAdmins: bool(live['apply_to_admins']),
      branchName: props.branchName,
      dismissStaleApprovals: bool(live['dismiss_stale_approvals']),
      enablePush: bool(live['enable_push'], true),
      enableStatusCheck: bool(live['enable_status_check']),
      ignoreStaleApprovals: bool(live['ignore_stale_approvals']),
      owner: props.owner,
      repo: props.repo,
      requireSignedCommits: bool(live['require_signed_commits']),
      requiredApprovals: int(live['required_approvals']),
      statusCheckContexts: stringArray(live['status_check_contexts']),
    };
  },
  collection: (props) => `repos/${props.owner}/${props.repo}/branch_protections`,
  createForm: branchProtectionForm,
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
  path: (props) => `repos/${props.owner}/${props.repo}/branch_protections/${props.branchName}`,
  updateForm: branchProtectionForm,
});

export const ForgejoBranchProtectionProvider = () =>
  Provider.effect(
    ForgejoBranchProtection,
    Effect.succeed(ForgejoBranchProtection.Provider.of(handlers)),
  );
