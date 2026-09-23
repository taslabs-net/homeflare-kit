/**
 * (ii) The write-recording fake, refusals: duplicate names, bypass widening, an undeclared live
 * rule, required checks omitted, and a never-reported context each make ZERO writes; and a
 * readback mismatch fails even though the write itself "succeeded" (S10). The happy paths
 * (create, noop, update) are repository-ruleset-write.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeGetOnlyFake, makeRecordingFake } from './repository-ruleset-fake-octokit.ts';
import type { RulesetOctokit } from './repository-ruleset-probe.ts';
import {
  BASE_PULL_REQUEST,
  fails,
  props,
  reconcileAgainst,
  reconcileWithOctokit,
  tagOf,
} from './repository-ruleset-test-helpers.ts';

describe('refusals make zero writes', () => {
  test('duplicate ruleset names', async () => {
    const fake: RulesetOctokit = {
      list: () =>
        Effect.succeed([
          { id: 1, name: 'main', target: 'branch' },
          { id: 2, name: 'main', target: 'branch' },
        ]),
      get: () => Effect.succeed(undefined),
      create: () => Effect.fail(new Error('must not be called')),
      update: () => Effect.fail(new Error('must not be called')),
      delete: () => Effect.fail(new Error('must not be called')),
      hasContextReportedSuccess: () => Effect.succeed(true),
    };
    const error = await fails(reconcileWithOctokit(fake, props()));
    expect(tagOf(error)).toBe('DuplicateRuleset');
  });

  test('bypass widening', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const error = await fails(
      reconcileWithOctokit(fake, props({ bypassActors: [{ actorType: 'OrganizationAdmin' }] }), {
        rulesetId: 1,
      }),
    );
    expect(tagOf(error)).toBe('BypassActorWidened');
  });

  test('a refused live rule type (e.g. workflows) blocks any write', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [{ type: 'workflows', parameters: {} }],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const error = await fails(reconcileWithOctokit(fake, props(), { rulesetId: 1 }));
    expect(tagOf(error)).toBe('UndeclaredLiveRule');
  });

  test('required checks omitted while the live ruleset has them', async () => {
    const live = {
      id: 1,
      name: 'main',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'ci' }] },
        },
      ],
    };
    const fake = makeGetOnlyFake({ widgets: live });
    const declaration = props({
      rules: { deletion: true, nonFastForward: true, pullRequest: BASE_PULL_REQUEST },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration, { rulesetId: 1 }));
    expect(tagOf(error)).toBe('RequiredChecksOmitted');
  });

  test('a never-reported context refuses before any write', async () => {
    const fake = makeRecordingFake({});
    // `reportedContexts` starts empty — `ci` has never reported.
    const error = await fails(reconcileAgainst(fake, props()));
    expect(tagOf(error)).toBe('NeverReportedContext');
    expect(fake.writes).toHaveLength(0);
  });
});

describe('readback', () => {
  test('fails when the independent re-read does not match what was sent', async () => {
    // A hand-built fake, not `makeRecordingFake` — the point here is specifically that `get`
    // (the INDEPENDENT re-read) can disagree with what `create` echoed back, simulating GitHub
    // accepting the write but not persisting it as declared (S10: never trust the write's own
    // report as proof).
    const created = {
      id: 1,
      name: 'main',
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [],
      conditions: {},
      rules: [
        {
          type: 'pull_request',
          parameters: { required_approving_review_count: 0, allowed_merge_methods: ['squash'] },
        },
      ],
    };
    const persisted = {
      ...created,
      rules: [
        // GitHub silently kept every method instead of narrowing to squash.
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            allowed_merge_methods: ['merge', 'squash', 'rebase'],
          },
        },
      ],
    };
    const fake: RulesetOctokit = {
      list: () => Effect.succeed([]),
      get: () => Effect.succeed(persisted),
      create: () => Effect.succeed(created),
      update: () => Effect.fail(new Error('not exercised')),
      delete: () => Effect.fail(new Error('not exercised')),
      hasContextReportedSuccess: () => Effect.succeed(true),
    };
    const declaration = props({
      rules: { deletion: true, nonFastForward: true, pullRequest: BASE_PULL_REQUEST },
    });
    const error = await fails(reconcileWithOctokit(fake, declaration));
    expect(tagOf(error)).toBe('ReadbackMismatch');
  });
});
