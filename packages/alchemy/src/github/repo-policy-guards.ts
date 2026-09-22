/**
 * Everything `repoPolicy` refuses, and why. Extracted from repo-policy-form.ts so the
 * shape stays readable and the reasoning stays whole.
 *
 * ⛔ THREE DIFFERENT DOORS LEAD TO THE SAME FAILURE — auto-merge with nothing to wait for.
 *   `gh pr merge --auto` is a queue only while something is outstanding; with nothing
 *   outstanding GitHub merges the pull request on the spot. An empty `checks` is the
 *   obvious door. `enforcement: 'disabled'` or `'evaluate'` is the quiet one: the ruleset
 *   exists, the required checks are listed on it, and none of them block anything. An
 *   empty `include` is the quietest of all — a ruleset that matches no ref enforces on
 *   no ref, and the GitHub UI still shows it as active. All three are refused.
 */

/** A non-empty, trimmed identifier, or an error naming the field. */
export function requireName(field: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') throw new Error(`repoPolicy: ${field} is required`);
  return trimmed;
}

/**
 * Trim, de-duplicate, sort. ★ The sort is what makes a second deploy a no-op: GitHub
 * stores the contexts in the order they were sent, so an unsorted list would diff against
 * itself the first time a caller wrote the same contexts in a different order.
 */
export function normalizeChecks(checks: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of checks) {
    const context = raw.trim();
    // ⚠️ A blank context is a typo that reads as coverage: GitHub happily stores it and
    //   no job ever reports it, so every pull request waits on a check that cannot come.
    if (context === '') {
      throw new Error(
        'repoPolicy: a required check context is blank — name it exactly as the job reports it',
      );
    }
    seen.add(context);
  }
  return [...seen].sort();
}

/**
 * ⛔ AN EMPTY `include` IS REFUSED. Alchemy defaults `conditions.include` to `['~ALL']`
 *   when it is absent, but an explicitly empty array is sent as an empty array, and a
 *   ruleset that matches no ref protects nothing while still reading as `active` in the
 *   GitHub UI — the worst possible combination, because it looks like it worked.
 */
export function normalizeInclude(
  include: readonly string[] | undefined,
  fallback: readonly string[],
): string[] {
  if (include === undefined) return [...fallback];
  if (include.length === 0) {
    throw new Error(
      'repoPolicy: include is empty — a ruleset that matches no ref enforces nothing. Omit it for the default branch.',
    );
  }
  return [...include];
}

/**
 * ⛔ `0` IS REFUSED, NOT TREATED AS "NO REVIEWS". A `pull_request` rule with zero
 *   approvals is the solo-maintainer shape — every change through a PR, no second person
 *   — and it only works with `require_extra_approval_for_unattributed_changes: false`.
 *   alchemy@2.0.0-beta.79's `Ruleset` cannot express that field, and GitHub defaults it
 *   to `true` when it is omitted (measured 2026-09-17), which blocks the very PRs the
 *   zero was meant to let through. Omitting `requiredApprovals` declares no rule at all,
 *   which is a different and honest thing.
 */
export function resolveApprovals(requested: number | undefined): number | undefined {
  if (requested === undefined) return undefined;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(
      [
        'repoPolicy: requiredApprovals must be a whole number of 1 or more.',
        'Omit it to declare no pull_request rule.',
        '0 is not that: it needs require_extra_approval_for_unattributed_changes: false,',
        'which alchemy@2.0.0-beta.79 cannot send and GitHub defaults to true.',
      ].join(' '),
    );
  }
  return requested;
}

/**
 * ⚠️ THE TEST IS "SOMETHING OUTSTANDING", NOT "SOME CHECKS". A required review holds a
 *   pull request open just as a required check does, so `requiredApprovals` with an empty
 *   `checks` is a legitimate policy. What is refused is auto-merge over a ruleset that
 *   will not hold anything back.
 */
export function assertAutoMergeWaits(input: {
  readonly autoMerge: boolean;
  readonly checkCount: number;
  readonly approvals: number | undefined;
  readonly enforcement: 'active' | 'disabled' | 'evaluate';
}): void {
  if (!input.autoMerge) return;
  if (input.enforcement !== 'active') {
    throw new Error(
      [
        `repoPolicy: autoMerge with enforcement '${input.enforcement}' merges every pull request immediately.`,
        'A ruleset that is not active enforces none of its rules, so auto-merge has nothing to wait for.',
        'Pass autoMerge: false while the ruleset is being evaluated.',
      ].join(' '),
    );
  }
  if (input.checkCount === 0 && input.approvals === undefined) {
    throw new Error(
      [
        'repoPolicy: autoMerge with nothing required merges every pull request immediately.',
        'Name at least one always-reporting check context, or ask for requiredApprovals,',
        'or pass autoMerge: false for a repository that has no green run to require yet.',
      ].join(' '),
    );
  }
}
