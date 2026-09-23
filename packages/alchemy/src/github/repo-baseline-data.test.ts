/**
 * Pins the house baseline VALUES so a loosening (an extra merge method, a dropped `deletion`
 * rule, `extraApprovalForUnattributedChanges` flipped) shows up as a reviewed diff in THIS
 * file, not as a silent change to every repo that adopts `declareRepoBaseline`.
 */
import { describe, expect, test } from 'bun:test';
import { repoBaselineRuleset, repoBaselineSettings } from './repo-baseline-data.ts';

const input = {
  owner: 'taslabs-net',
  repository: 'widgets',
  checks: ['ci', 'secret scan'],
  visibility: 'private' as const,
};

describe('repoBaselineSettings', () => {
  test('squash-only, auto-merge on, wiki off — identical for private and public', () => {
    expect(repoBaselineSettings(input)).toEqual({
      owner: 'taslabs-net',
      name: 'widgets',
      visibility: 'private',
      allowSquashMerge: true,
      allowMergeCommit: false,
      allowRebaseMerge: false,
      allowAutoMerge: true,
      deleteBranchOnMerge: true,
      hasWiki: false,
    });
  });

  test('a public repo gets the same settings, only visibility differs', () => {
    const publicSettings = repoBaselineSettings({ ...input, visibility: 'public' });
    const privateSettings = repoBaselineSettings(input);
    expect({ ...publicSettings, visibility: undefined }).toEqual({
      ...privateSettings,
      visibility: undefined,
    });
  });
});

describe('repoBaselineRuleset', () => {
  test('pins the exact ruleset shape the GitHub-baseline plan specifies', () => {
    expect(repoBaselineRuleset(input)).toEqual({
      owner: 'taslabs-net',
      repository: 'widgets',
      name: 'main',
      target: 'branch',
      enforcement: 'active',
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
          allowedMergeMethods: ['squash'],
          extraApprovalForUnattributedChanges: false,
        },
        requiredStatusChecks: {
          checks: [{ context: 'ci' }, { context: 'secret scan' }],
          strictRequiredStatusChecksPolicy: false,
          doNotEnforceOnCreate: false,
        },
      },
    });
  });

  test('no checks (homeflare/anyauth/desktop today) omits requiredStatusChecks entirely', () => {
    const ruleset = repoBaselineRuleset({ ...input, checks: [] });
    expect(ruleset.rules.requiredStatusChecks).toBeUndefined();
  });
});
