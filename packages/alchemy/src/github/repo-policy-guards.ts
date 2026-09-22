/**
 * Everything `repoPolicy` refuses, and why. Extracted from repo-policy-form.ts so the
 * shape stays readable and the reasoning stays whole.
 *
 * ⛔ FIVE DIFFERENT DOORS LEAD TO THE SAME FAILURE — auto-merge with nothing to wait for.
 *   `gh pr merge --auto` is a queue only while something is outstanding; with nothing
 *   outstanding GitHub merges the pull request on the spot. An empty `checks` is the
 *   obvious door. `enforcement: 'disabled'` or `'evaluate'` is the quiet one: the ruleset
 *   exists, the required checks are listed on it, and none of them block anything. Then
 *   three ways to end up with a ruleset that matches NO REF — which enforces on no ref
 *   while the GitHub UI still shows it as `active`: an empty `include`, a blank ref
 *   pattern, and an `exclude` that cancels every `include`. All five are refused.
 *
 * ★ THE REF DOORS WERE FOUND BY ADVERSARIAL REVIEW, NOT BY DESIGN. The first cut of this
 *   module guarded `include.length === 0` and spread `exclude` raw, so
 *   `include: ['~DEFAULT_BRANCH'], exclude: ['~DEFAULT_BRANCH']` and `include: ['   ']`
 *   both sailed through with `allowAutoMerge: true` — the exact end state the empty-array
 *   guard exists to prevent, reached by a door beside it. Checked by execution, not by
 *   reading: see the `matches no ref` tests in repo-policy-form.test.ts.
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
 * Trim, de-duplicate, sort one list of ref patterns, refusing a blank one.
 *
 * ⚠️ A BLANK PATTERN IS NOT AN EMPTY LIST, AND THAT IS THE WHOLE TRAP. `['   ']` has
 *   length 1, so a guard that counts the array waves it through; GitHub then stores a ref
 *   condition that matches nothing. Same end state as `[]`, reached past the guard.
 * ★ Sorted for the same reason `normalizeChecks` is: GitHub echoes the patterns back in
 *   the order they were sent, so an unsorted list diffs against itself the first time a
 *   caller writes the same patterns in a different order.
 */
function normalizeRefs(field: string, patterns: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern === '') {
      throw new Error(
        `repoPolicy: a ${field} ref pattern is blank — a ruleset that matches no ref enforces nothing.`,
      );
    }
    seen.add(pattern);
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
  return normalizeRefs('include', include);
}

/**
 * ⛔ AN `exclude` THAT CANCELS EVERY `include` IS REFUSED. In a GitHub ruleset the
 *   exclusions win, so `include: ['~DEFAULT_BRANCH'], exclude: ['~DEFAULT_BRANCH']` is a
 *   ruleset over nothing — and it reads as a narrowing, which is what makes it worse than
 *   the empty array: the caller believes they scoped the policy, not switched it off.
 *
 * ⚠️ EXACT CANCELLATION ONLY, DELIBERATELY. GitHub's patterns are globs, so deciding in
 *   general whether some exclude swallows some include means implementing GitHub's
 *   matcher and being wrong about it quietly. This refuses the case that is decidable —
 *   every include pattern also appears verbatim in `exclude` — and leaves
 *   `exclude: ['refs/heads/*']` against `include: ['~DEFAULT_BRANCH']` to the operator.
 *   A narrower guard that is always right beats a broad one that false-refuses.
 */
export function normalizeExclude(
  exclude: readonly string[] | undefined,
  include: readonly string[],
): string[] {
  const patterns = exclude === undefined ? [] : normalizeRefs('exclude', exclude);
  if (patterns.length === 0) return patterns;
  const excluded = new Set(patterns);
  if (include.every((pattern) => excluded.has(pattern))) {
    throw new Error(
      [
        'repoPolicy: exclude cancels every include pattern, so the ruleset matches no ref and enforces nothing.',
        `include ${JSON.stringify(include)} is fully covered by exclude ${JSON.stringify(patterns)}.`,
      ].join(' '),
    );
  }
  return patterns;
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
