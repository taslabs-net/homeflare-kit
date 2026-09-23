/**
 * Create/edit request bodies for `Forgejo.BranchProtection` — extracted for the 250-line cap.
 *
 * ★ `repoCreateBranchProtection`'s request carries `branch_name`; `repoEditBranchProtection`'s
 *   carries `name` (the rule-name path segment) instead — both are covered by the two exports
 *   below, so branch-protection.ts never builds the field list twice.
 */
import type { BranchProtectionProps } from './branch-protection.ts';

const shared = (props: BranchProtectionProps) => ({
  ...(props.applyToAdmins === undefined ? {} : { apply_to_admins: props.applyToAdmins }),
  ...(props.dismissStaleApprovals === undefined
    ? {}
    : { dismiss_stale_approvals: props.dismissStaleApprovals }),
  ...(props.enablePush === undefined ? {} : { enable_push: props.enablePush }),
  ...(props.enableStatusCheck === undefined
    ? {}
    : { enable_status_check: props.enableStatusCheck }),
  ...(props.ignoreStaleApprovals === undefined
    ? {}
    : { ignore_stale_approvals: props.ignoreStaleApprovals }),
  ...(props.requireSignedCommits === undefined
    ? {}
    : { require_signed_commits: props.requireSignedCommits }),
  ...(props.requiredApprovals === undefined ? {} : { required_approvals: props.requiredApprovals }),
  ...(props.statusCheckContexts === undefined
    ? {}
    : { status_check_contexts: props.statusCheckContexts }),
});

export const createBranchProtectionForm = (props: BranchProtectionProps) => ({
  ...shared(props),
  branch_name: props.branchName,
});

export const editBranchProtectionForm = (props: BranchProtectionProps) => shared(props);
