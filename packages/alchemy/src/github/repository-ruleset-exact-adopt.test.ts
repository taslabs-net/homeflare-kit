/**
 * Exact-adopt pass-through, proven against the 5 live rulesets the red team found this resource
 * could not express before 2026-09-23 (design critique, "strongest_failure": `repoBaselineRuleset()`
 * hardcodes `bypassActors: []` and an unconditional `pullRequest` rule; every one of these 5
 * repos' live ruleset has a non-empty `bypass_actors`, and one — `taslabs-net/taslabs-net` — has
 * no live `pull_request` rule at all). This file proves the underlying `RepositoryRuleset`
 * resource (not the convenience `repoBaselineRuleset()`, which intentionally keeps its baseline
 * defaults — see repo-baseline-data.ts) can express all 5 shapes, and that declaring one exactly
 * is never treated as narrowing.
 *
 * ⚠️ RE-READ LIVE 2026-09-23 via `gh api repos/taslabs-net/<repo>/rulesets/<id>`, not copied
 *   from the design doc's own paraphrase — `bypass_mode` differs from the design critique's
 *   prose for `doesthishelp-workeropen` (measured: RepositoryRole 5 is `pull_request` mode and
 *   Integration 29110 is `always`, not the reverse) — see repository-ruleset-narrowing-guards.ts
 *   for the guard these fixtures exercise.
 *
 * ★ K1 LANDED 2026-09-23: `extraApprovalForUnattributedChanges` now declares `true`, not only
 *   `false` — the gap this file's earlier revision named as blocking a true zero-write adopt for
 *   aop/magictransit/loggarr/doesthishelp-workeropen (all four carry
 *   `require_extra_approval_for_unattributed_changes: true` live). The 4 fixtures below still
 *   prove the narrower claim: that `bypassActors` round-trips an arbitrary
 *   `actor_id`/`actor_type`/`bypass_mode` combination — single-actor by role, single-actor by
 *   integration, and multi-actor with mixed modes — onto the wire exactly as declared, with
 *   neither `BypassActorWidened` nor `BypassActorNarrowed` firing on a match; their declarations
 *   still use `BASE_PULL_REQUEST` (`extraApprovalForUnattributedChanges: false`), so each is
 *   still a genuine `update`, not a noop — that keeps this file's original point (bypass alone
 *   round-trips) legible on its own. The case K1 unblocks — `aop`'s FULL live shape, extra-
 *   approval flag included, as a true zero-write adopt — is proven in
 *   repository-ruleset-exact-adopt-k1.test.ts, split out purely to keep this file under the
 *   250-line cap.
 */
import { describe, expect, test } from 'bun:test';
import { makeGetOnlyFake, makeRecordingFake } from './repository-ruleset-fake-octokit.ts';
import {
  BASE_PULL_REQUEST,
  props,
  reconcileWithOctokit,
  run,
} from './repository-ruleset-test-helpers.ts';

describe('exact-adopt pass-through — live shapes measured 2026-09-23', () => {
  // The critical case: a non-empty bypass_actors AND an absent pull_request rule, both at once.
  // `gh api repos/taslabs-net/taslabs-net/rulesets/12206080`.
  test('taslabs-net/taslabs-net: non-empty bypass, no pull_request rule — zero-write adopt', async () => {
    const live = {
      id: 12206080,
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    };
    const fake = makeGetOnlyFake({ 'taslabs-net': live });
    const declaration = props({
      repository: 'taslabs-net',
      bypassActors: [{ actorType: 'RepositoryRole', actorId: 5, bypassMode: 'always' }],
      rules: { deletion: true, nonFastForward: true },
    });
    const attrs = await run(reconcileWithOctokit(fake, declaration, { rulesetId: 12206080 }));
    expect(attrs.rulesetId).toBe(12206080);
  });

  // `gh api repos/taslabs-net/aop/rulesets/14572279` — single RepositoryRole actor, mode
  // "always". Live `pull_request` also carries the K1 flag, so the write below is an `update`,
  // not a noop — the point here is that `bypassActors` alone sends back exactly what was
  // declared, and neither narrowing nor widening guard fires on a matching bypass list.
  test('aop: single RepositoryRole actor round-trips exactly', async () => {
    const live = {
      id: 14572279,
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeRecordingFake({ aop: live });
    const declaration = props({
      repository: 'aop',
      bypassActors: [{ actorType: 'RepositoryRole', actorId: 5, bypassMode: 'always' }],
      rules: { deletion: true, nonFastForward: true, pullRequest: BASE_PULL_REQUEST },
    });
    await run(reconcileWithOctokit(fake.octokit, declaration, { rulesetId: 14572279 }));
    expect(fake.writes[0]?.body?.bypass_actors).toEqual([
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ]);
  });

  // `gh api repos/taslabs-net/loggarr/rulesets/12323114` — a single Integration (Dependabot)
  // actor with `bypass_mode: "pull_request"`, not `"always"`.
  test('loggarr: single Integration actor, pull_request bypass mode, round-trips exactly', async () => {
    const live = {
      id: 12323114,
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 29110, actor_type: 'Integration', bypass_mode: 'pull_request' }],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeRecordingFake({ loggarr: live });
    const declaration = props({
      repository: 'loggarr',
      bypassActors: [{ actorType: 'Integration', actorId: 29110, bypassMode: 'pull_request' }],
      rules: { deletion: true, nonFastForward: true, pullRequest: BASE_PULL_REQUEST },
    });
    await run(reconcileWithOctokit(fake.octokit, declaration, { rulesetId: 12323114 }));
    expect(fake.writes[0]?.body?.bypass_actors).toEqual([
      { actor_id: 29110, actor_type: 'Integration', bypass_mode: 'pull_request' },
    ]);
  });

  // `gh api repos/taslabs-net/doesthishelp-workeropen/rulesets/12504824` — TWO actors with
  // DIFFERENT modes each (the design critique's own "(both)" shorthand for this repo).
  test('doesthishelp-workeropen: two actors, mixed bypass modes, round-trip exactly', async () => {
    const live = {
      id: 12504824,
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [
        { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' },
        { actor_id: 29110, actor_type: 'Integration', bypass_mode: 'always' },
      ],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeRecordingFake({ 'doesthishelp-workeropen': live });
    const declaration = props({
      repository: 'doesthishelp-workeropen',
      bypassActors: [
        { actorType: 'RepositoryRole', actorId: 5, bypassMode: 'pull_request' },
        { actorType: 'Integration', actorId: 29110, bypassMode: 'always' },
      ],
      rules: { deletion: true, nonFastForward: true, pullRequest: BASE_PULL_REQUEST },
    });
    await run(reconcileWithOctokit(fake.octokit, declaration, { rulesetId: 12504824 }));
    expect(fake.writes[0]?.body?.bypass_actors).toEqual([
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' },
      { actor_id: 29110, actor_type: 'Integration', bypass_mode: 'always' },
    ]);
  });

  // `gh api repos/taslabs-net/magictransit/rulesets/10470003` — same single-actor shape as
  // `aop`, kept as its own case because it is one of the 5 the design's own census named.
  test('magictransit: single RepositoryRole actor round-trips exactly', async () => {
    const live = {
      id: 10470003,
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeRecordingFake({ magictransit: live });
    const declaration = props({
      repository: 'magictransit',
      bypassActors: [{ actorType: 'RepositoryRole', actorId: 5, bypassMode: 'always' }],
      rules: { deletion: true, nonFastForward: true, pullRequest: BASE_PULL_REQUEST },
    });
    await run(reconcileWithOctokit(fake.octokit, declaration, { rulesetId: 10470003 }));
    expect(fake.writes[0]?.body?.bypass_actors).toEqual([
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ]);
  });
});
