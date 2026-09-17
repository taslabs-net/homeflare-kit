/**
 * Guards `scripts/github-ruleset.ts`: the rule shapes and the update-preservation logic.
 * The `@octokit/rest` adapter itself (a mock Octokit surface, no live writes) is covered
 * in tests/github-ruleset-gateway.test.ts — split to stay under the 250-line file cap.
 */
import { describe, expect, test } from 'bun:test';
import {
  type RulesetPayload,
  type RulesetRule,
  buildOwnedRules,
  buildPayload,
  buildRequiredStatusChecksRule,
  buildRules,
  describeRule,
  resolveRulesForUpdate,
} from '../scripts/github-ruleset.ts';

const CI_CHECKS_RULE: RulesetRule = {
  type: 'required_status_checks',
  parameters: {
    strict_required_status_checks_policy: false,
    do_not_enforce_on_create: false,
    required_status_checks: [{ context: 'ci' }, { context: 'secret scan' }],
  },
};

describe('buildOwnedRules / buildRules', () => {
  test('the 3 owned rules never change shape: deletion, non_fast_forward, solo pull_request', () => {
    expect(buildOwnedRules()).toEqual([
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          allowed_merge_methods: ['squash', 'merge', 'rebase'],
        },
      },
    ]);
  });

  // ⛔ Finding: the installed OpenAPI schema does not accept `required_reviewers` or
  //   `require_extra_approval_for_unattributed_changes` on write, even though a live GET
  //   response includes both. Sending them would be silently ignored at best; asserting
  //   their absence here is what stops them from creeping back in as "helpful" fields.
  test('pull_request parameters never include fields the write schema does not accept', () => {
    const pr = buildOwnedRules().find((r) => r.type === 'pull_request');
    const keys = pr?.type === 'pull_request' ? Object.keys(pr.parameters) : [];

    expect(keys).not.toContain('required_reviewers');
    expect(keys).not.toContain('require_extra_approval_for_unattributed_changes');
    expect(keys.sort()).toEqual(
      [
        'allowed_merge_methods',
        'dismiss_stale_reviews_on_push',
        'require_code_owner_review',
        'require_last_push_approval',
        'required_approving_review_count',
        'required_review_thread_resolution',
      ].sort(),
    );
  });

  test('CREATE path: required checks OFF by default — no required_status_checks rule at all', () => {
    expect(buildRules(undefined)).toEqual(buildOwnedRules());
  });

  test('CREATE path: with checks requested, appends exactly one required_status_checks rule', () => {
    expect(buildRules(['ci', 'secret scan'])).toEqual([...buildOwnedRules(), CI_CHECKS_RULE]);
  });

  test('buildRequiredStatusChecksRule maps each context 1:1, order preserved', () => {
    expect(buildRequiredStatusChecksRule(['a', 'b', 'c'])).toEqual({
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'a' }, { context: 'b' }, { context: 'c' }],
      },
    });
  });
});

describe('resolveRulesForUpdate — UPDATE path only', () => {
  test('omitted flag + no current rule stays OFF, same as create', () => {
    expect(resolveRulesForUpdate(undefined, undefined)).toEqual(buildOwnedRules());
  });

  // ⛔ THE BUG THIS GUARDS. A plain rerun with no flags must not silently drop required
  //   checks a previous run (or a human, by hand) already turned on.
  test('omitted flag + a current rule PRESERVES IT EXACTLY, not rebuilt from defaults', () => {
    // strict_required_status_checks_policy: true here — deliberately NOT this script's
    // default of false — to prove preservation reads the live value, not rebuilds it.
    const customCurrent: RulesetRule = {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: true,
        required_status_checks: [{ context: 'a-human-added-check' }],
      },
    };

    expect(resolveRulesForUpdate(undefined, customCurrent)).toEqual([
      ...buildOwnedRules(),
      customCurrent,
    ]);
  });

  test('explicit --require-checks REPLACES the current rule, even when one already exists', () => {
    const current: RulesetRule = {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: true,
        required_status_checks: [{ context: 'old-check' }],
      },
    };

    expect(resolveRulesForUpdate(['ci', 'secret scan'], current)).toEqual([
      ...buildOwnedRules(),
      CI_CHECKS_RULE,
    ]);
  });

  test('explicit --require-checks with no current rule still adds it (matches create)', () => {
    expect(resolveRulesForUpdate(['ci'], undefined)).toEqual([
      ...buildOwnedRules(),
      {
        ...CI_CHECKS_RULE,
        parameters: { ...CI_CHECKS_RULE.parameters, required_status_checks: [{ context: 'ci' }] },
      },
    ]);
  });
});

describe('buildPayload', () => {
  test('assembles the fixed target/enforcement/conditions with the given rules and bypass actors', () => {
    const bypass = [{ actor_type: 'Team' as const, actor_id: 1, bypass_mode: 'always' as const }];
    const payload: RulesetPayload = buildPayload(buildOwnedRules(), bypass);

    expect(payload.name).toBe('main');
    expect(payload.target).toBe('branch');
    expect(payload.enforcement).toBe('active');
    expect(payload.conditions).toEqual({ ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } });
    expect(payload.bypass_actors).toEqual(bypass);
    expect(payload.rules).toEqual([...buildOwnedRules()]);
  });
});

describe('describeRule', () => {
  test('describes every real rule type', () => {
    for (const rule of buildRules(['ci'])) {
      expect(describeRule(rule)).toBeTruthy();
    }
  });

  test('throws on an unhandled rule type instead of silently ignoring it', () => {
    const bogus = { type: 'bogus' } as unknown as RulesetRule;
    expect(() => describeRule(bogus)).toThrow('unhandled rule type');
  });
});

// The octokitGateway adapter (mock Octokit surface, no live writes) is covered in
// tests/github-ruleset-gateway.test.ts.
