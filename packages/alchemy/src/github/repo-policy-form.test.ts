import { describe, expect, test } from 'bun:test';
import { type RepoPolicyRepositorySettings, repoPolicy } from './repo-policy-form.ts';

const base = { checks: ['ci', 'secret scan'], owner: 'acme', repository: 'widget' } as const;

describe('repoPolicy — the repository half', () => {
  test('squash only, auto-merge on, head branches deleted', () => {
    const { repository } = repoPolicy(base);

    expect(repository).toMatchObject({
      allowAutoMerge: true,
      allowMergeCommit: false,
      allowRebaseMerge: false,
      allowSquashMerge: true,
      deleteBranchOnMerge: true,
      name: 'widget',
      owner: 'acme',
    });
  });

  test('caller settings pass through but cannot re-open a merge method', () => {
    // ⛔ The policy fields are spread AFTER `settings` for exactly this reason. A caller
    //   who could turn merge commits back on here would defeat the helper silently.
    // ★ `RepoPolicyRepositorySettings` already OMITS the merge keys, so this cast is the
    //   only way to write the call at all — the type is the first guard, this is the
    //   second, for a JavaScript consumer the compiler never sees.
    const settings = { allowMergeCommit: true, description: 'a widget' } as unknown;
    const { repository } = repoPolicy({
      ...base,
      settings: settings as RepoPolicyRepositorySettings,
    });

    expect(repository.description).toBe('a widget');
    expect(repository.allowMergeCommit).toBe(false);
  });
});

describe('repoPolicy — the ruleset half', () => {
  test('covers the default branch, blocks deletion and force pushes, strict off', () => {
    const { ruleset } = repoPolicy(base);

    expect(ruleset).toMatchObject({
      enforcement: 'active',
      name: 'main',
      owner: 'acme',
      repository: 'widget',
      target: 'branch',
    });
    expect(ruleset.conditions).toEqual({ exclude: [], include: ['~DEFAULT_BRANCH'] });
    expect(ruleset.rules?.deletion).toBe(true);
    expect(ruleset.rules?.nonFastForward).toBe(true);
    expect(ruleset.rules?.requiredStatusChecks?.strictRequiredStatusChecksPolicy).toBe(false);
  });

  test('nobody bypasses unless the caller names an actor', () => {
    expect(repoPolicy(base).ruleset.bypassActors).toEqual([]);
    expect(
      repoPolicy({ ...base, bypassActors: [{ actorId: 5, actorType: 'RepositoryRole' }] }).ruleset
        .bypassActors,
    ).toEqual([{ actorId: 5, actorType: 'RepositoryRole' }]);
  });

  test('checks are trimmed, de-duplicated and sorted, so re-ordering is not a diff', () => {
    // ⚠️ THE NO-OP PROPERTY. GitHub stores the contexts in the order they were sent, so
    //   an unsorted list would diff against itself the first time someone wrote the same
    //   two contexts the other way round — a deploy that changes nothing and says it did.
    const one = repoPolicy({ ...base, checks: ['ci', 'secret scan'] });
    const other = repoPolicy({ ...base, checks: [' secret scan ', 'ci', 'ci'] });

    expect(other).toEqual(one);
    expect(one.ruleset.rules?.requiredStatusChecks?.checks).toEqual([
      { context: 'ci' },
      { context: 'secret scan' },
    ]);
  });

  test('the ruleset name and the refs it covers are the callers', () => {
    const { ruleset } = repoPolicy({
      ...base,
      exclude: ['refs/heads/dev/*'],
      include: ['refs/heads/release/*'],
      rulesetName: 'release',
    });

    expect(ruleset.name).toBe('release');
    expect(ruleset.conditions).toEqual({
      exclude: ['refs/heads/dev/*'],
      include: ['refs/heads/release/*'],
    });
  });
});

describe('repoPolicy — required reviews are opt-in', () => {
  test('no pull_request rule unless approvals were asked for', () => {
    expect(repoPolicy(base).ruleset.rules?.pullRequest).toBeUndefined();
  });

  test('asking for approvals declares the rule and dismisses stale reviews', () => {
    expect(repoPolicy({ ...base, requiredApprovals: 2 }).ruleset.rules?.pullRequest).toEqual({
      dismissStaleReviewsOnPush: true,
      requiredApprovingReviewCount: 2,
    });
  });

  test('zero approvals is refused, naming the flag Alchemy cannot send', () => {
    // ⛔ Not pedantry: 0 is the solo-maintainer shape, and it needs a field the vendor
    //   resource has no property for. Accepting it would ship a rule that blocks the
    //   pull requests it was written to allow.
    expect(() => repoPolicy({ ...base, requiredApprovals: 0 })).toThrow(
      /require_extra_approval_for_unattributed_changes/,
    );
  });

  test('a fractional or negative count is refused too', () => {
    expect(() => repoPolicy({ ...base, requiredApprovals: 1.5 })).toThrow(/whole number/);
    expect(() => repoPolicy({ ...base, requiredApprovals: -1 })).toThrow(/whole number/);
  });
});

describe('repoPolicy — the auto-merge trap', () => {
  test('auto-merge with nothing required at all is refused', () => {
    // ⛔ THE TRAP THIS HELPER EXISTS FOR. `gh pr merge --auto` is a queue only while
    //   something is outstanding; with nothing required GitHub merges on the spot.
    expect(() => repoPolicy({ ...base, checks: [] })).toThrow(/immediately/);
  });

  test('a required review is something outstanding, so an empty checks list is fine', () => {
    // ⚠️ The guard is not "no checks": auto-merge waits on a required approval too, and
    //   refusing that combination would block a legitimate review-gated repository.
    const { repository, ruleset } = repoPolicy({ ...base, checks: [], requiredApprovals: 1 });

    expect(repository.allowAutoMerge).toBe(true);
    expect(ruleset.rules?.requiredStatusChecks).toBeUndefined();
    expect(ruleset.rules?.pullRequest?.requiredApprovingReviewCount).toBe(1);
  });

  test('turning auto-merge off is the only way to declare an empty checks list', () => {
    const { repository, ruleset } = repoPolicy({ ...base, autoMerge: false, checks: [] });

    expect(repository.allowAutoMerge).toBe(false);
    expect(ruleset.rules?.requiredStatusChecks).toBeUndefined();
    // The branch is still protected — that is the point of the bootstrap state.
    expect(ruleset.rules?.deletion).toBe(true);
    expect(ruleset.rules?.nonFastForward).toBe(true);
  });

  test('a blank context is refused rather than stored as a check nothing reports', () => {
    expect(() => repoPolicy({ ...base, checks: ['ci', '  '] })).toThrow(/blank/);
  });

  test('auto-merge over a ruleset that is not enforcing is refused', () => {
    // ⚠️ THE QUIET DOOR. The checks are listed on the ruleset and none of them block
    //   anything, so auto-merge lands the pull request while the plan looks correct.
    expect(() => repoPolicy({ ...base, enforcement: 'evaluate' })).toThrow(/enforcement/);
    expect(() => repoPolicy({ ...base, enforcement: 'disabled' })).toThrow(/immediately/);
    expect(
      repoPolicy({ ...base, autoMerge: false, enforcement: 'evaluate' }).ruleset.enforcement,
    ).toBe('evaluate');
  });

  test('an explicitly empty include is refused — it would match no ref at all', () => {
    // ⚠️ THE QUIETEST DOOR. GitHub still shows the ruleset as active; it just covers
    //   nothing, so every rule on it is decorative.
    expect(() => repoPolicy({ ...base, include: [] })).toThrow(/matches no ref/);
  });

  test('a blank ref pattern is refused — length is not coverage', () => {
    // ⚠️ THE DOOR BESIDE THE GUARD. `['   ']` has length 1, so a guard that counts the
    //   array passes it; GitHub then stores a condition that matches nothing. Identical
    //   end state to `include: []`, reached past the check that exists to stop it.
    expect(() => repoPolicy({ ...base, include: ['   '] })).toThrow(/blank/);
    expect(() => repoPolicy({ ...base, exclude: [''] })).toThrow(/blank/);
  });

  test('an exclude that cancels every include is refused', () => {
    // ⚠️ THE DOOR THAT READS AS A NARROWING. Exclusions win in a GitHub ruleset, so this
    //   is a ruleset over nothing — but it looks like scoping, not like switching off.
    expect(() => repoPolicy({ ...base, exclude: ['~DEFAULT_BRANCH'] })).toThrow(
      /cancels every include/,
    );
    expect(() =>
      repoPolicy({
        ...base,
        exclude: ['refs/heads/release/*', 'refs/heads/main'],
        include: ['refs/heads/main', 'refs/heads/release/*'],
      }),
    ).toThrow(/cancels every include/);
  });

  test('an exclude that leaves an include standing is a narrowing, and allowed', () => {
    // ★ EXACT CANCELLATION ONLY. Deciding glob overlap in general means reimplementing
    //   GitHub's matcher; a narrow guard that is always right beats a broad one that
    //   false-refuses a legitimate scope.
    const { ruleset } = repoPolicy({
      ...base,
      exclude: ['refs/heads/release/*'],
      include: ['~DEFAULT_BRANCH', 'refs/heads/release/*'],
    });

    // ★ Sorted, so `refs/…` precedes the `~` tokens — the ordering is normalization, not
    //   a preference, and it is what keeps a second deploy from diffing against itself.
    expect(ruleset.conditions).toEqual({
      exclude: ['refs/heads/release/*'],
      include: ['refs/heads/release/*', '~DEFAULT_BRANCH'],
    });
  });

  test('ref patterns are trimmed, de-duplicated and sorted, so re-ordering is not a diff', () => {
    const one = repoPolicy({ ...base, include: ['refs/heads/main', 'refs/heads/release/*'] });
    const other = repoPolicy({
      ...base,
      include: [' refs/heads/release/* ', 'refs/heads/main', 'refs/heads/main'],
    });

    expect(other).toEqual(one);
  });
});

describe('repoPolicy — one host for both halves', () => {
  test('baseUrl reaches the repository and the ruleset, or neither', () => {
    // ⛔ Setting it on one would point the repository at an Enterprise host and its
    //   ruleset at github.com — two halves of one policy on two different instances.
    const { repository, ruleset } = repoPolicy({ ...base, baseUrl: 'github.example.com' });

    expect(repository.baseUrl).toBe('github.example.com');
    expect(ruleset.baseUrl).toBe('github.example.com');

    const plain = repoPolicy(base);
    expect('baseUrl' in plain.repository).toBe(false);
    expect('baseUrl' in plain.ruleset).toBe(false);
  });
});

describe('repoPolicy — required inputs', () => {
  test('an empty owner or repository is refused', () => {
    expect(() => repoPolicy({ ...base, owner: ' ' })).toThrow(/owner is required/);
    expect(() => repoPolicy({ ...base, repository: '' })).toThrow(/repository is required/);
  });
});
