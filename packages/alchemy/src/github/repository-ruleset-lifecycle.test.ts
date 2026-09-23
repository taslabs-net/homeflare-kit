/**
 * (i) GET-only loopback fake serving the 16 captured rulesets: cold adoption never creates a
 * duplicate, the house baseline plans real drift against every one of them (none has
 * `allowed_merge_methods: [squash]` yet), and the canonicalization fix (repository-ruleset-
 * form.ts) reads a reordered-but-equal live ruleset as a noop while still catching real drift —
 * the mutation check.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { LIVE_RULESET_FIXTURES } from './repository-ruleset-fixtures.ts';
import { makeGetOnlyFake } from './repository-ruleset-fake-octokit.ts';
import { canonicalizeWireRuleset, desiredWireRuleset } from './repository-ruleset-form.ts';
import { probeByName } from './repository-ruleset-probe.ts';
import type { RepositoryRulesetProps } from './repository-ruleset.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const baselineProps = (
  owner: string,
  repository: string,
  checks: readonly string[],
): RepositoryRulesetProps => ({
  owner,
  repository,
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
    ...(checks.length === 0
      ? {}
      : { requiredStatusChecks: { checks: checks.map((context) => ({ context })) } }),
  },
});

const STANDARD_REPOS = Object.entries(LIVE_RULESET_FIXTURES).filter(
  ([repo]) => !['homeflare', 'anyauth', 'desktop'].includes(repo),
);

describe('probeByName over the 16 live fixtures', () => {
  test('finds exactly the one ruleset each repo has, never a duplicate', async () => {
    const fake = makeGetOnlyFake(LIVE_RULESET_FIXTURES);
    for (const [repo, live] of Object.entries(LIVE_RULESET_FIXTURES)) {
      const found = await run(
        probeByName(fake, { owner: 'taslabs-net', repo, name: 'main', target: 'branch' }),
      );
      expect(found?.id).toBe(live.id);
    }
  });

  test('a repo with no ruleset probes to undefined, not a create-blocking error', async () => {
    const fake = makeGetOnlyFake(LIVE_RULESET_FIXTURES);
    const found = await run(
      probeByName(fake, { owner: 'taslabs-net', repo: 'builds', name: 'main', target: 'branch' }),
    );
    expect(found).toBeUndefined();
  });
});

describe('house baseline vs every live fixture', () => {
  test('all 16 show real drift today: none has allowed_merge_methods narrowed to squash', () => {
    for (const [repo, live] of Object.entries(LIVE_RULESET_FIXTURES)) {
      const checks =
        repo === 'homeflare' || repo === 'anyauth' || repo === 'desktop'
          ? []
          : ['ci', 'secret scan'];
      const desired = desiredWireRuleset(baselineProps('taslabs-net', repo, checks));
      const same =
        JSON.stringify(canonicalizeWireRuleset(desired)) ===
        JSON.stringify(canonicalizeWireRuleset(live));
      expect(same).toBe(false);
    }
  });

  test(`${String(STANDARD_REPOS.length)} standard repos differ ONLY in allowed_merge_methods and the extension flag`, () => {
    for (const [repo, live] of STANDARD_REPOS) {
      const desired = desiredWireRuleset(baselineProps('taslabs-net', repo, ['ci', 'secret scan']));
      // Patch just those two fields onto the live record and expect a match — proves the
      // 13 "already matching" repos truly match everywhere else the survey claims they do.
      const patchedRules = (live.rules ?? []).map((r) =>
        r.type === 'pull_request'
          ? {
              ...r,
              parameters: {
                ...(r.parameters as Record<string, unknown>),
                allowed_merge_methods: ['squash'],
                require_extra_approval_for_unattributed_changes: false,
              },
            }
          : r,
      );
      const patched = { ...live, rules: patchedRules };
      const same =
        JSON.stringify(canonicalizeWireRuleset(desired)) ===
        JSON.stringify(canonicalizeWireRuleset(patched));
      expect(same).toBe(true);
    }
  });
});

describe('canonicalization: reorder is a noop, real drift is not (the never-noop fix)', () => {
  const repo = 'openbao';
  const desired = desiredWireRuleset(baselineProps('taslabs-net', repo, ['ci', 'secret scan']));
  const matching = {
    ...desired,
    // Same policy, reordered `rules`, reordered `allowed_merge_methods`/checks, and an
    // `integration_id: null` GitHub adds that the request never sent.
    rules: [...(desired.rules ?? [])].reverse().map((r) =>
      r.type === 'required_status_checks' && r.parameters !== undefined
        ? {
            ...r,
            parameters: {
              ...r.parameters,
              required_status_checks: [...r.parameters.required_status_checks]
                .reverse()
                .map((c) => ({
                  ...c,
                  integration_id: null,
                })),
            },
          }
        : r,
    ),
  };

  test('a reordered-but-equal live ruleset canonicalizes to a noop', () => {
    expect(JSON.stringify(canonicalizeWireRuleset(desired))).toBe(
      JSON.stringify(canonicalizeWireRuleset(matching)),
    );
    // Sanity: the RAW (un-canonicalized) forms really do differ in order, so this is not a
    // vacuous "already identical" comparison.
    expect(JSON.stringify(desired)).not.toBe(JSON.stringify(matching));
  });

  test('mutation check: 3 independently changed values give 3 independently non-noop results', () => {
    const mutations: Record<string, unknown> = {
      'a dismissed check dropped': {
        ...matching,
        rules: matching.rules.map((r) =>
          r.type === 'required_status_checks'
            ? { ...r, parameters: { ...r.parameters, required_status_checks: [{ context: 'ci' }] } }
            : r,
        ),
      },
      'enforcement disabled': { ...matching, enforcement: 'disabled' },
      'a bypass actor added': {
        ...matching,
        bypass_actors: [{ actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
      },
    };
    let nonNoop = 0;
    for (const value of Object.values(mutations)) {
      const same =
        JSON.stringify(canonicalizeWireRuleset(desired)) ===
        JSON.stringify(canonicalizeWireRuleset(value));
      if (!same) nonNoop++;
    }
    expect(nonNoop).toBe(Object.keys(mutations).length);
  });
});
