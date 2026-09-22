/**
 * Create/PATCH bodies for `Forgejo.BranchProtection` — extracted for the 250-line cap.
 *
 * ★ READ OFF `<estate>/mcp-servers/docs/api/upstream/forgejo.json` — create posts
 *   `CreateBranchProtectionOption`; update sends `EditBranchProtectionOption` fields only.
 */
import type { BranchProtectionProps } from './branch-protection.ts';

export const branchProtectionForm = (props: BranchProtectionProps) => ({
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
  rule_name: props.branchName,
});
