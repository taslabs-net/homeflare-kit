/**
 * Narrowing refusals (repository-ruleset-narrowing-guards.ts), split out of
 * repository-ruleset-write-refusals.test.ts purely to keep both files under the 250-line cap.
 * `acknowledgeRuleNarrowing`/`acknowledgeBypassNarrowing` are the escape hatches: without the
 * matching one, dropping a live rule or a live bypass actor is refused; with a non-empty reason
 * on the RIGHT prop, it writes exactly what was declared. The two are intentionally separate
 * props, not one shared flag — see the 'mixed narrowing' describe block below and the file
 * header on repository-ruleset-narrowing-guards.ts for the 2026-09-23 finding this fixes. The
 * dedicated exact-adopt fixtures (all 5 live non-empty-bypass shapes, none of which are
 * "narrowing" — they match live exactly) are repository-ruleset-exact-adopt.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeGetOnlyFake, makeRecordingFake } from './repository-ruleset-fake-octokit.ts';
import {
  BASE_PULL_REQUEST,
  fails,
  props,
  reconcileAgainst,
  reconcileWithOctokit,
  tagOf,
} from './repository-ruleset-test-helpers.ts';

describe('rule narrowing', () => {
  // Regression for the gap the exact-adopt pass-through work closed 2026-09-23: an explicit
  // `false` alone used to be enough to drop a live rule, with no record of WHY. It is now also
  // gated on `acknowledgeRuleNarrowing` — see repository-ruleset-narrowing-guards.ts.
  test('dropping a live rule (deletion declared false) without acknowledgeRuleNarrowing is refused', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [
        { type: 'deletion' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const declaration = props({
      rules: { deletion: false, pullRequest: BASE_PULL_REQUEST },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('RuleNarrowed');
  });

  test('the SAME drop, acknowledged with a reason, is a deliberate removal and writes once', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [
        { type: 'deletion' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeRecordingFake({ widgets: live });
    fake.reportedContexts.add('ci');
    const declaration = props({
      rules: { deletion: false, pullRequest: BASE_PULL_REQUEST },
      acknowledgeRuleNarrowing: { reason: 'Tim approved dropping delete-protection 2026-09-23' },
    });
    await reconcileAgainst(fake, declaration, { rulesetId: 1 }).pipe(Effect.runPromise);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]?.op).toBe('update');
    const sentTypes = fake.writes[0]?.body?.rules?.map((r) => r.type);
    expect(sentTypes).not.toContain('deletion');
  });

  // A blank (or whitespace-only) reason is not an acknowledgement —
  // `isRuleNarrowingAcknowledged` (repository-ruleset-narrowing-guards.ts) requires a
  // non-empty, TRIMMED reason, so this is indistinguishable from omitting
  // `acknowledgeRuleNarrowing` entirely and gets the same refusal.
  test('acknowledgeRuleNarrowing with a blank reason does not count as acknowledged', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [
        { type: 'deletion' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const declaration = props({
      rules: { deletion: false, pullRequest: BASE_PULL_REQUEST },
      acknowledgeRuleNarrowing: { reason: '   ' },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('RuleNarrowed');
  });

  // Scoping regression (2026-09-23 review finding): an acknowledgement reasoned for the RULE
  // drop must not also excuse a bypass-actor drop declared in the SAME declaration.
  test('acknowledgeRuleNarrowing does not excuse an unrelated bypass-actor drop', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      conditions: {},
      rules: [
        { type: 'deletion' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const declaration = props({
      bypassActors: [],
      rules: { deletion: false, pullRequest: BASE_PULL_REQUEST },
      acknowledgeRuleNarrowing: { reason: 'Tim approved dropping delete-protection 2026-09-23' },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('BypassActorNarrowed');
  });
});

describe('bypass narrowing', () => {
  test('dropping a live bypass actor without acknowledgeBypassNarrowing is refused', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      conditions: {},
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const declaration = props({
      bypassActors: [],
      rules: { deletion: true, nonFastForward: true },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('BypassActorNarrowed');
  });

  test('the SAME drop, acknowledged with a reason, writes the narrowed list', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      conditions: {},
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    };
    const fake = makeRecordingFake({ widgets: live });
    const declaration = props({
      bypassActors: [],
      rules: { deletion: true, nonFastForward: true },
      acknowledgeBypassNarrowing: { reason: 'Tim revoked admin bypass 2026-09-23' },
    });
    await reconcileAgainst(fake, declaration, { rulesetId: 1 }).pipe(Effect.runPromise);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]?.body?.bypass_actors).toEqual([]);
  });

  // Widening stays refused even alongside an acknowledgement — `acknowledgeBypassNarrowing`
  // gates ONLY narrowing (repository-ruleset-narrowing-guards.ts's file header explains why).
  test('acknowledgeBypassNarrowing does not excuse widening', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const declaration = props({
      bypassActors: [{ actorType: 'OrganizationAdmin' }],
      acknowledgeBypassNarrowing: { reason: 'irrelevant to widening' },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('BypassActorWidened');
  });

  // Scoping regression (2026-09-23 review finding), the mirror of the rule-narrowing case
  // above: an acknowledgement reasoned for the BYPASS drop must not also excuse an unrelated
  // rule drop declared in the SAME declaration.
  test('acknowledgeBypassNarrowing does not excuse an unrelated rule drop', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      conditions: {},
      rules: [
        { type: 'deletion' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
      ],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const declaration = props({
      bypassActors: [],
      rules: { deletion: false, pullRequest: BASE_PULL_REQUEST },
      acknowledgeBypassNarrowing: { reason: 'Tim revoked admin bypass 2026-09-23' },
    });
    // The bypass drop is acknowledged (so `bypassNarrowingRefusal` passes), but the rule drop
    // is not — `reconcileRuleset` checks bypass narrowing before rule narrowing, so a REFUSED
    // rule drop under a bypass-only acknowledgement surfaces as `RuleNarrowed`, proving the
    // bypass acknowledgement did not also cover it.
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('RuleNarrowed');
  });
});
