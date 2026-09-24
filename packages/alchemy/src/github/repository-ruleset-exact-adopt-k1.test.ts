/**
 * K1 (2026-09-23): `extraApprovalForUnattributedChanges` now declares `true`, not only `false`
 * — split out of repository-ruleset-exact-adopt.test.ts purely to keep that file under the
 * 250-line cap, not because the case is unrelated: this is the exact gap that file's own header
 * named as blocking a true zero-write adopt for aop/magictransit/loggarr/
 * doesthishelp-workeropen (all four carry `require_extra_approval_for_unattributed_changes:
 * true` live).
 *
 * `gh api repos/taslabs-net/aop/rulesets/14572279`, re-read 2026-09-23 for this PR — the FULL
 * record (not H15's own caution about paraphrasing was heeded the hard way: an earlier revision
 * of this fixture hand-typed only the fields the design doc had quoted, which omitted
 * `dismiss_stale_reviews_on_push: true` and `required_reviewers: []` — both of which
 * `buildPullRequestRule` always sends, so a fixture missing them can never truly noop; the "zero
 * writes" assertion below caught it): `bypass_actors: [{actor_id: 5, actor_type:
 * "RepositoryRole", bypass_mode: "always"}]`, `rules: [deletion, non_fast_forward, pull_request]`,
 * and the full `pull_request` parameters are `required_approving_review_count: 0`,
 * `dismiss_stale_reviews_on_push: true`, `required_reviewers: []`, `require_code_owner_review:
 * false`, `require_last_push_approval: false`, `required_review_thread_resolution: false`,
 * `require_extra_approval_for_unattributed_changes: true`,
 * `allowed_merge_methods: [merge, squash, rebase]`.
 */
import { describe, expect, test } from 'bun:test';
import { makeRecordingFake } from './repository-ruleset-fake-octokit.ts';
import {
  BASE_PULL_REQUEST,
  props,
  reconcileWithOctokit,
  run,
} from './repository-ruleset-test-helpers.ts';

const AOP_LIVE = {
  id: 14572279,
  name: 'main',
  target: 'branch',
  enforcement: 'active',
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        required_reviewers: [],
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        require_extra_approval_for_unattributed_changes: true,
        allowed_merge_methods: ['merge', 'squash', 'rebase'],
      },
    },
  ],
};

describe('K1: extraApprovalForUnattributedChanges completes exact-adopt', () => {
  // Unlike repository-ruleset-exact-adopt.test.ts's bypass-only fixture (which deliberately
  // keeps `BASE_PULL_REQUEST`'s `false`/`[squash]` to prove bypass round-trips on its own), this
  // declares aop's FULL live `pull_request` shape — methods AND the extra-approval flag — so
  // the whole ruleset, not just `bypassActors`, is now a genuine zero-write adopt.
  test('aop: full live shape, extra-approval flag included, makes zero writes', async () => {
    const fake = makeRecordingFake({ aop: AOP_LIVE });
    const declaration = props({
      repository: 'aop',
      bypassActors: [{ actorType: 'RepositoryRole', actorId: 5, bypassMode: 'always' }],
      rules: {
        deletion: true,
        nonFastForward: true,
        pullRequest: {
          ...BASE_PULL_REQUEST,
          dismissStaleReviewsOnPush: true,
          allowedMergeMethods: ['merge', 'squash', 'rebase'],
          extraApprovalForUnattributedChanges: true,
        },
      },
    });
    await run(reconcileWithOctokit(fake.octokit, declaration, { rulesetId: 14572279 }));
    expect(fake.writes).toHaveLength(0);
  });

  // The counterpart failure mode: declaring `false` against a live `true` is real drift (not a
  // narrowing/widening question — that guard family is about `bypassActors` and rule presence,
  // not this field's value) and must still produce exactly one `update`, never a silent noop.
  test('aop: declaring false against a live true is drift, not a noop', async () => {
    const fake = makeRecordingFake({ aop: AOP_LIVE });
    const declaration = props({
      repository: 'aop',
      bypassActors: [{ actorType: 'RepositoryRole', actorId: 5, bypassMode: 'always' }],
      rules: {
        deletion: true,
        nonFastForward: true,
        pullRequest: {
          ...BASE_PULL_REQUEST,
          dismissStaleReviewsOnPush: true,
          allowedMergeMethods: ['merge', 'squash', 'rebase'],
          extraApprovalForUnattributedChanges: false,
        },
      },
    });
    await run(reconcileWithOctokit(fake.octokit, declaration, { rulesetId: 14572279 }));
    expect(fake.writes).toHaveLength(1);
    const pr = fake.writes[0]?.body?.rules?.find((r) => r.type === 'pull_request');
    expect(
      (pr as { parameters: Record<string, unknown> } | undefined)?.parameters
        .require_extra_approval_for_unattributed_changes,
    ).toBe(false);
  });
});
