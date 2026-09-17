/**
 * Guards the UPDATE path of `applyMainRuleset` specifically: required-checks
 * preservation and `bypass_actors` preservation. Split from
 * tests/apply-main-ruleset.test.ts (parseArgs, fails-closed, CREATE) to stay under the
 * 250-line file cap — see AGENTS.md.
 *
 * ⛔ NO LIVE GITHUB WRITES. Drives `applyMainRuleset` through the same fake
 *   `RulesetGateway` pattern as the sibling file; no `@octokit/rest` call is ever made.
 */
import { describe, expect, test } from 'bun:test';
import { applyMainRuleset } from '../scripts/apply-main-ruleset.ts';
import { type RulesetGateway } from '../scripts/github-ruleset-gateway.ts';
import {
  type RulesetDetail,
  type RulesetPayload,
  type RulesetRule,
  type RulesetSummary,
  buildOwnedRules,
} from '../scripts/github-ruleset.ts';

function detail(overrides: {
  readonly id: number;
  readonly bypassActors?: readonly RulesetDetail['bypassActors'][number][];
  readonly requiredStatusChecksRule?: RulesetRule | undefined;
  readonly foreignRuleTypes?: readonly string[];
}): RulesetDetail {
  return {
    id: overrides.id,
    name: 'main',
    bypassActors: overrides.bypassActors ?? [],
    requiredStatusChecksRule: overrides.requiredStatusChecksRule,
    foreignRuleTypes: overrides.foreignRuleTypes ?? [],
    htmlUrl: undefined,
  };
}

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
      return detail({ id: 999 });
    },
    update: async (repo, rulesetId, payload) => {
      calls.update.push({ repo, rulesetId, payload });
      return detail({ id: rulesetId });
    },
  };

  return { gateway, calls };
}

describe('applyMainRuleset — UPDATE (existing ruleset)', () => {
  test('preserves existing bypass_actors — never widens or silently clears them', async () => {
    const teamBypass = [
      { actor_id: 42, actor_type: 'Team' as const, bypass_mode: 'always' as const },
    ];
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: detail({ id: 7, bypassActors: teamBypass }),
    });

    const result = await applyMainRuleset(gateway, { repo: 'homeflare-kit', dryRun: false });

    expect(result.action).toBe('updated');
    expect(calls.get).toEqual([{ repo: 'homeflare-kit', rulesetId: 7 }]);
    expect(calls.update[0]?.payload.bypass_actors).toEqual(teamBypass);
  });

  // ⛔ THE FINDING THIS FIXES. Before: omitting --require-checks always rebuilt `rules`
  //   from `buildRules(undefined)`, which has no required_status_checks entry — so a
  //   plain rerun against a repo that already required "ci" would silently strip it.
  test('omitting --require-checks on update PRESERVES the current required_status_checks rule exactly', async () => {
    const currentRule: RulesetRule = {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true, // NOT this script's default — proves preservation, not rebuild.
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'ci' }, { context: 'secret scan' }],
      },
    };
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: detail({ id: 7, requiredStatusChecksRule: currentRule }),
    });

    await applyMainRuleset(gateway, { repo: 'homeflare-kit', dryRun: false });

    expect(calls.update[0]?.payload.rules).toEqual([...buildOwnedRules(), currentRule]);
  });

  test('omitting --require-checks on a repo with none stays off, does not invent one', async () => {
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: detail({ id: 7 }),
    });

    await applyMainRuleset(gateway, { repo: 'homeflare-kit', dryRun: false });

    expect(calls.update[0]?.payload.rules).toEqual([...buildOwnedRules()]);
  });

  test('explicit --require-checks REPLACES whatever required_status_checks rule already exists', async () => {
    const oldRule: RulesetRule = {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: true,
        required_status_checks: [{ context: 'old-check' }],
      },
    };
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: detail({ id: 7, requiredStatusChecksRule: oldRule }),
    });

    await applyMainRuleset(gateway, {
      repo: 'homeflare-kit',
      dryRun: false,
      requiredChecks: ['ci', 'secret scan'],
    });

    const rules = calls.update[0]?.payload.rules ?? [];
    const updatedCheck = rules.find((r) => r.type === 'required_status_checks');
    expect(updatedCheck).toEqual({
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'ci' }, { context: 'secret scan' }],
      },
    });
  });

  test('dry-run never calls update, and still reports the rules it WOULD have preserved', async () => {
    const currentRule: RulesetRule = {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'ci' }],
      },
    };
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 1, name: 'main', target: 'branch' }],
      detail: detail({ id: 1, requiredStatusChecksRule: currentRule }),
    });

    const result = await applyMainRuleset(gateway, { repo: 'x', dryRun: true });

    expect(result.action).toBe('dry-run-update');
    expect(calls.update).toEqual([]);
    expect(result.rules).toContainEqual(currentRule);
  });

  // ⛔ THE MINOR THIS GUARDS. Convergence deliberately removes a rule type this script
  //   does not manage — that must be reported EXACTLY, not left for the operator to
  //   discover by diffing GitHub afterward.
  test('reports exactly which nonstandard rule types a real update will remove', async () => {
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: detail({ id: 7, foreignRuleTypes: ['creation', 'commit_message_pattern'] }),
    });

    const result = await applyMainRuleset(gateway, { repo: 'homeflare-kit', dryRun: false });

    expect(result.action).toBe('updated');
    expect(result.removedRuleTypes).toEqual(['creation', 'commit_message_pattern']);
    // ⛔ Reporting is not preserving: the write still converges, unwatched.
    expect(calls.update).toHaveLength(1);
  });

  test('--dry-run reports the identical removedRuleTypes a real update would, and still writes nothing', async () => {
    const { gateway, calls } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: detail({ id: 7, foreignRuleTypes: ['creation'] }),
    });

    const result = await applyMainRuleset(gateway, { repo: 'homeflare-kit', dryRun: true });

    expect(result.action).toBe('dry-run-update');
    expect(result.removedRuleTypes).toEqual(['creation']);
    expect(calls.update).toEqual([]);
  });

  test('no nonstandard rule types on the live ruleset means nothing to report', async () => {
    const { gateway } = fakeGateway({
      existing: [{ id: 7, name: 'main', target: 'branch' }],
      detail: detail({ id: 7 }),
    });

    const result = await applyMainRuleset(gateway, { repo: 'homeflare-kit', dryRun: false });

    expect(result.removedRuleTypes).toEqual([]);
  });
});
