/**
 * Guards `scripts/apply-main-ruleset.ts`: the CLI argument parsing and the upsert
 * decision (create vs. update, duplicate refusal, required-checks preservation).
 *
 * ⛔ NO LIVE GITHUB WRITES. Every test drives `applyMainRuleset` through a fake
 *   `RulesetGateway` that records calls instead of talking to `@octokit/rest` — the
 *   real adapter is covered separately in tests/github-ruleset.test.ts, against a mock
 *   Octokit surface, also with no live writes.
 */
import { describe, expect, test } from 'bun:test';
import { applyMainRuleset, parseArgs } from '../scripts/apply-main-ruleset.ts';
import {
  type RulesetDetail,
  type RulesetGateway,
  type RulesetPayload,
  type RulesetRule,
  type RulesetSummary,
  buildOwnedRules,
} from '../scripts/github-ruleset.ts';

function detail(overrides: {
  readonly id: number;
  readonly bypassActors?: readonly RulesetDetail['bypassActors'][number][];
  readonly requiredStatusChecksRule?: RulesetRule | undefined;
}): RulesetDetail {
  return {
    id: overrides.id,
    name: 'main',
    bypassActors: overrides.bypassActors ?? [],
    requiredStatusChecksRule: overrides.requiredStatusChecksRule,
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

describe('parseArgs', () => {
  test('fails closed without --repo', () => {
    expect(() => parseArgs([])).toThrow('--repo is required');
    expect(() => parseArgs(['--dry-run'])).toThrow('--repo is required');
  });

  test('rejects an owner/repo pair — this script always targets taslabs-net', () => {
    expect(() => parseArgs(['--repo', 'taslabs-net/homeflare-kit'])).toThrow('bare repo name');
  });

  test('required checks stay undefined (OFF for create) unless the flag is given', () => {
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

  // ⛔ THE BUG THIS GUARDS. Without value validation, `--require-checks --dry-run`
  //   silently consumed "--dry-run" as a single bogus check context, left the real
  //   --dry-run flag unprocessed (so dryRun stayed false), and would have gone on to
  //   WRITE a ruleset requiring a check literally named "--dry-run".
  test('--require-checks immediately followed by another flag fails closed', () => {
    expect(() => parseArgs(['--repo', 'x', '--require-checks', '--dry-run'])).toThrow(
      '--require-checks needs a value',
    );
  });

  test('--require-checks as the last argument (no value at all) fails closed', () => {
    expect(() => parseArgs(['--repo', 'x', '--require-checks'])).toThrow(
      '--require-checks needs a value',
    );
  });

  // Same class of bug, the other value flag: a flag-shaped repo name must not be
  // silently accepted just because it also matches the bare-name regex.
  test('--repo immediately followed by another flag fails closed', () => {
    expect(() => parseArgs(['--repo', '--dry-run'])).toThrow('--repo needs a value');
  });

  test('--repo as the last argument (no value at all) fails closed', () => {
    expect(() => parseArgs(['--repo'])).toThrow('--repo needs a value');
  });
});

describe('applyMainRuleset — fails closed', () => {
  test('on an empty repo, before calling the gateway at all', async () => {
    const { gateway, calls } = fakeGateway({});

    await expect(applyMainRuleset(gateway, { repo: '  ', dryRun: false })).rejects.toThrow(
      '--repo is required',
    );
    expect(calls.list).toEqual([]);
  });

  // ⛔ THE BUG THIS GUARDS. `.find()` silently picked the first of several "main"
  //   rulesets targeting `branch` and converged only that one, leaving any duplicate
  //   untouched and unreported — exactly the kind of drift a maintenance script must
  //   refuse to guess through.
  test('on two rulesets both named "main" targeting branch — refuses, reads and writes nothing', async () => {
    const { gateway, calls } = fakeGateway({
      existing: [
        { id: 1, name: 'main', target: 'branch' },
        { id: 2, name: 'main', target: 'branch' },
      ],
    });

    await expect(applyMainRuleset(gateway, { repo: 'x', dryRun: false })).rejects.toThrow(
      /2 rulesets named "main".*ids: 1, 2/,
    );
    expect(calls.get).toEqual([]);
    expect(calls.create).toEqual([]);
    expect(calls.update).toEqual([]);
  });

  test('three or more duplicates are reported by count and id, not just "more than one"', async () => {
    const { gateway } = fakeGateway({
      existing: [
        { id: 1, name: 'main', target: 'branch' },
        { id: 2, name: 'main', target: 'branch' },
        { id: 3, name: 'main', target: 'branch' },
      ],
    });

    await expect(applyMainRuleset(gateway, { repo: 'x', dryRun: false })).rejects.toThrow(
      /3 rulesets named "main".*ids: 1, 2, 3/,
    );
  });

  test('a ruleset named "main" targeting a tag does not count toward the duplicate check', async () => {
    const { gateway, calls } = fakeGateway({
      existing: [
        { id: 1, name: 'main', target: 'branch' },
        { id: 2, name: 'main', target: 'tag' },
      ],
      detail: detail({ id: 1 }),
    });

    const result = await applyMainRuleset(gateway, { repo: 'x', dryRun: false });

    expect(result.action).toBe('updated');
    expect(calls.get).toEqual([{ repo: 'x', rulesetId: 1 }]);
  });
});

describe('applyMainRuleset — CREATE (no existing ruleset)', () => {
  test('creates a locked-down ruleset (bypass_actors: []) with required checks OFF by default', async () => {
    const { gateway, calls } = fakeGateway({ existing: [] });

    const result = await applyMainRuleset(gateway, { repo: 'homeflare-alerts', dryRun: false });

    expect(result.action).toBe('created');
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]?.payload.bypass_actors).toEqual([]);
    expect(calls.create[0]?.payload.enforcement).toBe('active');
    expect(calls.create[0]?.payload.rules).toEqual([...buildOwnedRules()]);
  });

  test('required checks flow into the create payload only when explicitly requested', async () => {
    const { gateway, calls } = fakeGateway({ existing: [] });

    await applyMainRuleset(gateway, {
      repo: 'homeflare-kit',
      dryRun: false,
      requiredChecks: ['ci', 'secret scan'],
    });

    const rules = calls.create[0]?.payload.rules ?? [];
    expect(rules.find((r) => r.type === 'required_status_checks')).toBeDefined();
  });

  test('dry-run never calls create', async () => {
    const { gateway, calls } = fakeGateway({ existing: [] });
    const result = await applyMainRuleset(gateway, { repo: 'x', dryRun: true });

    expect(result.action).toBe('dry-run-create');
    expect(calls.create).toEqual([]);
  });
});

// UPDATE-path tests (required-checks preservation, bypass_actors) live in
// tests/apply-main-ruleset-update.test.ts — split to stay under the 250-line file cap.
