/**
 * Guards `scripts/apply-main-ruleset.ts` and `scripts/github-ruleset.ts`.
 *
 * ⛔ NO LIVE GITHUB WRITES. Every test drives `applyMainRuleset` through a fake
 *   `RulesetGateway` that records calls instead of talking to `@octokit/rest` — the real
 *   adapter (`octokitGateway`) is exercised only by inspection here, never invoked.
 *
 * ★ THE FIXTURE BELOW IS READ EVIDENCE, NOT A GUESS. It is
 *   `taslabs-net/homeflare-kit`'s own live ruleset, read via
 *   `gh api repos/taslabs-net/homeflare-kit/rulesets/23471358` on 2026-09-16 — this repo
 *   asserting its script reproduces the branch protection it is already running under.
 */
import { describe, expect, test } from 'bun:test';
import { applyMainRuleset, parseArgs } from '../scripts/apply-main-ruleset.ts';
import {
  type RulesetDetail,
  type RulesetGateway,
  type RulesetPayload,
  type RulesetRule,
  type RulesetSummary,
  buildRules,
  describeRule,
} from '../scripts/github-ruleset.ts';

const LIVE_RULES: readonly RulesetRule[] = [
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
      require_extra_approval_for_unattributed_changes: false,
      allowed_merge_methods: ['squash', 'merge', 'rebase'],
    },
  },
  {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: 'ci' }, { context: 'secret scan' }],
    },
  },
];

function fakeGateway(options: {
  readonly existing?: readonly RulesetSummary[];
  readonly detail?: RulesetDetail;
}) {
  const calls = {
    list: [] as string[],
    get: [] as { repo: string; rulesetId: number }[],
    create: [] as { repo: string; payload: RulesetPayload }[],
    update: [] as { repo: string; rulesetId: number; payload: RulesetPayload }[],
  };

  const gateway: RulesetGateway = {
    list: async (repo) => {
      calls.list.push(repo);
      return options.existing ?? [];
    },
    get: async (repo, rulesetId) => {
      calls.get.push({ repo, rulesetId });
      if (options.detail === undefined) throw new Error('test fixture has no detail');
      return options.detail;
    },
    create: async (repo, payload) => {
      calls.create.push({ repo, payload });
      return { id: 999, name: payload.name, bypassActors: payload.bypass_actors };
    },
    update: async (repo, rulesetId, payload) => {
      calls.update.push({ repo, rulesetId, payload });
      return { id: rulesetId, name: payload.name, bypassActors: payload.bypass_actors };
    },
  };

  return { gateway, calls };
}

describe('buildRules', () => {
  test('required checks OFF by default — no required_status_checks rule at all', () => {
    expect(buildRules(undefined)).toEqual(LIVE_RULES.slice(0, 3));
  });

  test('with checks requested, matches the live homeflare-kit ruleset exactly', () => {
    expect(buildRules(['ci', 'secret scan'])).toEqual(LIVE_RULES);
  });

  test('solo PR requirement stays 0 approvals, never silently raised', () => {
    const pr = buildRules(undefined).find((r) => r.type === 'pull_request');
    expect(pr?.type === 'pull_request' && pr.parameters.required_approving_review_count).toBe(0);
  });
});

describe('describeRule', () => {
  test('describes every real rule type', () => {
    for (const rule of buildRules(['ci'])) {
      expect(describeRule(rule)).toBeTruthy();
    }
  });

  test('throws on an unhandled rule type instead of silently ignoring it', () => {
    const bogus = { type: 'bogus' } as unknown as ReturnType<typeof buildRules>[number];
    expect(() => describeRule(bogus)).toThrow('unhandled rule type');
  });
});

describe('parseArgs', () => {
  test('fails closed without --repo', () => {
    expect(() => parseArgs([])).toThrow('--repo is required');
    expect(() => parseArgs(['--dry-run'])).toThrow('--repo is required');
  });

  test('rejects an owner/repo pair — this script always targets taslabs-net', () => {
    expect(() => parseArgs(['--repo', 'taslabs-net/homeflare-kit'])).toThrow('bare repo name');
  });

  test('required checks stay undefined (OFF) unless the flag is given', () => {
    expect(parseArgs(['--repo', 'homeflare-alerts']).requiredChecks).toBeUndefined();
  });

  test('--require-checks with no contexts fails closed rather than meaning "off"', () => {
    expect(() => parseArgs(['--repo', 'x', '--require-checks', ' , ,'])).toThrow(
      'at least one context',
    );
  });

  test('splits and trims a comma-separated check list', () => {
    const options = parseArgs(['--repo', 'x', '--require-checks', 'ci, secret scan']);
    expect(options.requiredChecks).toEqual(['ci', 'secret scan']);
  });

  test('--dry-run is off unless passed', () => {
    expect(parseArgs(['--repo', 'x']).dryRun).toBe(false);
    expect(parseArgs(['--repo', 'x', '--dry-run']).dryRun).toBe(true);
  });
});

describe('applyMainRuleset', () => {
  test('fails closed on an empty repo before calling the gateway at all', async () => {
    const { gateway, calls } = fakeGateway({});

    await expect(applyMainRuleset(gateway, { repo: '  ', dryRun: false })).rejects.toThrow(
      '--repo is required',
    );
    expect(calls.list).toEqual([]);
  });

  test('creates a locked-down ruleset (bypass_actors: []) when none exists yet', async () => {
    const { gateway, calls } = fakeGateway({ existing: [] });

    const result = await applyMainRuleset(gateway, { repo: 'homeflare-alerts', dryRun: false });

    expect(result.action).toBe('created');
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]?.payload.bypass_actors).toEqual([]);
    expect(calls.create[0]?.payload.enforcement).toBe('active');
    // ⛔ Required checks OFF by default even on create.
    expect(calls.create[0]?.payload.rules).toEqual(LIVE_RULES.slice(0, 3));
  });

  test('preserves existing bypass_actors on update — never widens or silently clears them', async () => {
    const teamBypass = [{ actor_id: 42, actor_type: 'Team', bypass_mode: 'always' }];
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: { id: 7, name: 'main', bypassActors: teamBypass },
    });

    const result = await applyMainRuleset(gateway, { repo: 'homeflare-kit', dryRun: false });

    expect(result.action).toBe('updated');
    expect(calls.get).toEqual([{ repo: 'homeflare-kit', rulesetId: 7 }]);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0]?.payload.bypass_actors).toEqual(teamBypass);
  });

  test('required checks flow through into the payload only when requested', async () => {
    const { gateway, calls } = fakeGateway({ existing: [] });

    await applyMainRuleset(gateway, {
      repo: 'homeflare-kit',
      dryRun: false,
      requiredChecks: ['ci', 'secret scan'],
    });

    expect(calls.create[0]?.payload.rules).toEqual(LIVE_RULES);
  });

  test('dry-run never calls create or update', async () => {
    const { gateway: createGateway, calls: createCalls } = fakeGateway({ existing: [] });
    await applyMainRuleset(createGateway, { repo: 'x', dryRun: true });
    expect(createCalls.create).toEqual([]);

    const { gateway: updateGateway, calls: updateCalls } = fakeGateway({
      existing: [{ id: 1, name: 'main', target: 'branch' }],
      detail: { id: 1, name: 'main', bypassActors: [] },
    });
    await applyMainRuleset(updateGateway, { repo: 'x', dryRun: true });
    expect(updateCalls.update).toEqual([]);
  });

  test('an existing ruleset targeting the wrong ref is not mistaken for "main"', async () => {
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 5, name: 'main', target: 'tag' }],
    });

    const result = await applyMainRuleset(gateway, { repo: 'x', dryRun: false });

    expect(result.action).toBe('created');
    expect(calls.get).toEqual([]);
  });
});
