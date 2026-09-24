/**
 * Narrowing refusals (repository-ruleset-narrowing-guards.ts), split out of
 * repository-ruleset-write-refusals.test.ts purely to keep both files under the 250-line cap.
 * `acknowledgeNarrowing` is the escape hatch: without it, dropping a live bypass actor or a live
 * rule is refused; with a non-empty reason, it writes exactly what was declared. The dedicated
 * exact-adopt fixtures (all 5 live non-empty-bypass shapes, none of which are "narrowing" —
 * they match live exactly) are repository-ruleset-exact-adopt.test.ts.
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
  // gated on `acknowledgeNarrowing` — see repository-ruleset-narrowing-guards.ts.
  test('dropping a live rule (deletion declared false) without acknowledgeNarrowing is refused', async () => {
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
      acknowledgeNarrowing: { reason: 'Tim approved dropping delete-protection 2026-09-23' },
    });
    await reconcileAgainst(fake, declaration, { rulesetId: 1 }).pipe(Effect.runPromise);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]?.op).toBe('update');
    const sentTypes = fake.writes[0]?.body?.rules?.map((r) => r.type);
    expect(sentTypes).not.toContain('deletion');
  });

  // A blank (or whitespace-only) reason is not an acknowledgement — `isNarrowingAcknowledged`
  // (repository-ruleset-narrowing-guards.ts) requires a non-empty, TRIMMED reason, so this is
  // indistinguishable from omitting `acknowledgeNarrowing` entirely and gets the same refusal.
  test('acknowledgeNarrowing with a blank reason does not count as acknowledged', async () => {
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
      acknowledgeNarrowing: { reason: '   ' },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('RuleNarrowed');
  });
});

describe('bypass narrowing', () => {
  test('dropping a live bypass actor without acknowledgeNarrowing is refused', async () => {
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
      acknowledgeNarrowing: { reason: 'Tim revoked admin bypass 2026-09-23' },
    });
    await reconcileAgainst(fake, declaration, { rulesetId: 1 }).pipe(Effect.runPromise);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]?.body?.bypass_actors).toEqual([]);
  });

  // Widening stays refused even alongside an acknowledgement — `acknowledgeNarrowing` gates
  // ONLY narrowing (repository-ruleset-narrowing-guards.ts's file header explains why).
  test('acknowledgeNarrowing does not excuse widening', async () => {
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
      acknowledgeNarrowing: { reason: 'irrelevant to widening' },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('BypassActorWidened');
  });
});
