/**
 * The house GitHub baseline, as plain data — the VALUES section of the GitHub-baseline plan
 * (2026-09-23), and nothing else. No provider import (S9's "pure core" pattern, the same split
 * repo-policy-form.ts uses): `declare-repo-baseline.ts` turns this into resources, and
 * `hf-repo-baseline-check.ts` reads it read-only against a live repo. Both import THIS file so
 * neither can drift from the other.
 *
 * ⚠️ IDENTICAL FOR PRIVATE AND PUBLIC, except the fields this module marks `publicOnly` —
 *   `security_and_analysis` is `null` on every private repo this estate has (LIVE SURVEY,
 *   2026-09-23), so secret scanning / push protection / private vulnerability reporting are
 *   not settable there at all, not merely off.
 */

export interface RepoBaselineInput {
  readonly owner: string;
  readonly repository: string;
  readonly checks: readonly string[];
  readonly visibility: 'public' | 'private';
  readonly description?: string;
}

/** `GitHub.Repository` fields this baseline owns. Every merge-automation caller across the 17
 * tray checkouts uses `--squash` (measured 2026-09-23; the only non-squash mentions are
 * GitLab-era comments in cliff.toml), so squash-only is not a per-repo choice. */
export function repoBaselineSettings(input: RepoBaselineInput) {
  return {
    owner: input.owner,
    name: input.repository,
    ...(input.description === undefined ? {} : { description: input.description }),
    visibility: input.visibility,
    allowSquashMerge: true,
    allowMergeCommit: false,
    allowRebaseMerge: false,
    allowAutoMerge: true,
    deleteBranchOnMerge: true,
    hasWiki: false,
  };
}

/** `GitHub.RepositoryRuleset` `main` — target branch, 0-approval solo-maintainer shape, the
 * named `checks` required, squash-only at the ruleset level too (H15's whole reason to exist:
 * the repository setting can be re-ticked in the UI; the ruleset is what actually enforces it). */
export function repoBaselineRuleset(input: RepoBaselineInput) {
  return {
    owner: input.owner,
    repository: input.repository,
    name: 'main',
    target: 'branch' as const,
    enforcement: 'active' as const,
    bypassActors: [],
    conditions: { include: ['~DEFAULT_BRANCH'], exclude: [] },
    rules: {
      deletion: true,
      nonFastForward: true,
      pullRequest: {
        requiredApprovingReviewCount: 0,
        dismissStaleReviewsOnPush: true,
        requireCodeOwnerReview: false,
        requireLastPushApproval: false,
        requiredReviewThreadResolution: false,
        allowedMergeMethods: ['squash' as const],
        extraApprovalForUnattributedChanges: false as const,
      },
      ...(input.checks.length === 0
        ? {}
        : {
            requiredStatusChecks: {
              checks: input.checks.map((context) => ({ context })),
              strictRequiredStatusChecksPolicy: false,
              doNotEnforceOnCreate: false,
            },
          }),
    },
  };
}

/** Public-only settings this baseline asserts but cannot express through either resource above
 * at `alchemy@2.0.0-beta.79` — recorded for the wave-3 handoff artifact (plan section 2), not
 * declared anywhere. Both already measured ON for `kit` (LIVE SURVEY 2026-09-23); `builds` is
 * the gap. */
export const PUBLIC_ONLY_UNDECLARABLE = [
  'secret_scanning: enabled',
  'secret_scanning_push_protection: enabled',
  'private_vulnerability_reporting: enabled',
  "fork-PR approval: 'first_time_contributors'",
] as const;
