/**
 * Verify GitHub's persisted solo-approval policy, including its undocumented flag.
 * ⚠️ A successful write is insufficient: omission previously left extra approval
 * enabled on both CREATE and UPDATE (measured 2026-09-17). Treat missing/unknown
 * values as unverified, never as false. The gateway calls this on a separate GET.
 */
export function assertSoloApprovals(
  rules: readonly { readonly type: string; readonly parameters?: unknown }[] | undefined,
): void {
  const parameters = rules?.find((rule) => rule.type === 'pull_request')?.parameters;
  if (
    parameters === null ||
    typeof parameters !== 'object' ||
    !('required_approving_review_count' in parameters) ||
    parameters.required_approving_review_count !== 0 ||
    !('require_extra_approval_for_unattributed_changes' in parameters) ||
    parameters.require_extra_approval_for_unattributed_changes !== false
  ) {
    throw new Error(
      'GitHub did not confirm zero approvals with extra unattributed-change approval disabled. ' +
        'The ruleset write may already have applied; inspect the live rule before retrying.',
    );
  }
}
