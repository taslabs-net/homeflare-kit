/**
 * Guards `octokitGateway`, the only place in this script that calls `@octokit/rest`.
 * Split from tests/github-ruleset.test.ts (rule shapes, update logic) to stay under the
 * 250-line file cap — see AGENTS.md.
 *
 * ⛔ NO LIVE GITHUB WRITES. Drives `octokitGateway` through a fake Octokit surface
 *   (`Octokit` typing removed via a single, test-local `as unknown as Octokit` — the
 *   "mock Octokit surface" the finding this file guards asked for) that records calls
 *   and returns canned data. `@octokit/rest` itself is never constructed with real
 *   credentials and never makes a network request.
 */
import type { Octokit } from '@octokit/rest';
import { describe, expect, test } from 'bun:test';
import { octokitGateway } from '../scripts/github-ruleset-gateway.ts';
import { buildOwnedRules, buildPayload } from '../scripts/github-ruleset.ts';

interface FakeOctokit {
  readonly paginate: (method: unknown, params: unknown) => Promise<readonly unknown[]>;
  readonly rest: {
    readonly repos: {
      readonly getRepoRulesets: (params: unknown) => Promise<{ data: readonly unknown[] }>;
      readonly getRepoRuleset: (params: unknown) => Promise<{ data: unknown }>;
      readonly createRepoRuleset: (params: unknown) => Promise<{ data: unknown }>;
      readonly updateRepoRuleset: (params: unknown) => Promise<{ data: unknown }>;
    };
  };
}

function fakeOctokit(options: {
  readonly rulesets?: readonly unknown[];
  readonly getResponse?: unknown;
}) {
  const calls = {
    paginateParams: [] as unknown[],
    get: [] as unknown[],
    create: [] as unknown[],
    update: [] as unknown[],
  };

  const responseFor = (id: unknown) => ({
    id,
    name: 'main',
    bypass_actors: [],
    rules: buildOwnedRules(),
    _links: { html: { href: `https://github.com/taslabs-net/x/rules/${String(id)}` } },
  });

  const fake: FakeOctokit = {
    paginate: async (_method, params) => {
      calls.paginateParams.push(params);
      return options.rulesets ?? [];
    },
    rest: {
      repos: {
        getRepoRulesets: async () => ({ data: options.rulesets ?? [] }),
        getRepoRuleset: async (params) => {
          calls.get.push(params);
          return {
            data: options.getResponse ?? responseFor((params as { ruleset_id: number }).ruleset_id),
          };
        },
        createRepoRuleset: async (params) => {
          calls.create.push(params);
          return { data: responseFor(999) };
        },
        updateRepoRuleset: async (params) => {
          calls.update.push(params);
          return { data: responseFor((params as { ruleset_id: number }).ruleset_id) };
        },
      },
    },
  };

  // The one sanctioned cast in this codebase for exactly this purpose: a mock Octokit
  // surface for adapter tests, never a request payload cast in production code.
  return { octokit: fake as unknown as Octokit, calls };
}

describe('octokitGateway', () => {
  // ⛔ THE BUG THIS GUARDS. Unpaginated getRepoRulesets returns only page 1; a duplicate
  //   "main" ruleset on page 2 would be invisible without this.
  test('list() goes through octokit.paginate with per_page set, never the raw unpaginated call', async () => {
    const { octokit, calls } = fakeOctokit({
      rulesets: [{ id: 1, name: 'main', target: 'branch' }],
    });

    const result = await octokitGateway(octokit).list('homeflare-kit');

    expect(result).toEqual([{ id: 1, name: 'main', target: 'branch' }]);
    expect(calls.paginateParams).toHaveLength(1);
    expect((calls.paginateParams[0] as { per_page?: number }).per_page).toBe(100);
  });

  test('create() sends exactly the built payload fields, no extra ones', async () => {
    const { octokit, calls } = fakeOctokit({});
    const payload = buildPayload(buildOwnedRules(), []);

    await octokitGateway(octokit).create('homeflare-kit', payload);

    expect(calls.create).toHaveLength(1);
    const sent = calls.create[0] as Record<string, unknown>;
    expect(sent['owner']).toBe('taslabs-net');
    expect(sent['repo']).toBe('homeflare-kit');
    expect(sent['name']).toBe('main');
    expect(sent['bypass_actors']).toEqual([]);
    expect(sent['rules']).toEqual(buildOwnedRules());
    expect(calls.get).toEqual([{ owner: 'taslabs-net', repo: 'homeflare-kit', ruleset_id: 999 }]);
  });

  test('update() sends the ruleset_id and the payload, and no live write happens without it', async () => {
    const { octokit, calls } = fakeOctokit({});
    const payload = buildPayload(buildOwnedRules(), []);

    await octokitGateway(octokit).update('homeflare-kit', 42, payload);

    expect(calls.update).toHaveLength(1);
    const sent = calls.update[0] as Record<string, unknown>;
    expect(sent['ruleset_id']).toBe(42);
    expect(sent['rules']).toEqual(buildOwnedRules());
    expect(calls.get).toEqual([{ owner: 'taslabs-net', repo: 'homeflare-kit', ruleset_id: 42 }]);
  });

  // ⛔ A success response from CREATE/UPDATE must not hide a retained/defaulted
  // approval gate. Exercise both writes through a separate contradictory GET.
  for (const operation of ['create', 'update'] as const) {
    for (const extraApproval of [true, undefined]) {
      test(`${operation} rejects persisted extra approval ${String(extraApproval)}`, async () => {
        const { octokit, calls } = fakeOctokit({
          getResponse: {
            id: 7,
            name: 'main',
            rules: [
              {
                type: 'pull_request',
                parameters: {
                  required_approving_review_count: 0,
                  require_extra_approval_for_unattributed_changes: extraApproval,
                },
              },
            ],
          },
        });
        const gateway = octokitGateway(octokit);
        const payload = buildPayload(buildOwnedRules(), []);
        const result =
          operation === 'create'
            ? gateway.create('homeflare-kit', payload)
            : gateway.update('homeflare-kit', 7, payload);
        await expect(result).rejects.toThrow('write may already have applied');
        expect(calls[operation]).toHaveLength(1);
        expect(calls.get).toHaveLength(1);
      });
    }
  }

  test('get() finds the live required_status_checks rule and REPORTS (not silently drops) rule types it does not own', async () => {
    const { octokit } = fakeOctokit({
      getResponse: {
        id: 7,
        name: 'main',
        bypass_actors: [{ actor_type: 'Team', actor_id: 1 }],
        rules: [
          { type: 'deletion' },
          { type: 'creation' }, // a rule type this script does not manage
          {
            type: 'required_status_checks',
            parameters: {
              strict_required_status_checks_policy: false,
              do_not_enforce_on_create: false,
              required_status_checks: [{ context: 'ci' }],
            },
          },
        ],
        _links: { html: { href: 'https://github.com/taslabs-net/x/rules/7' } },
      },
    });

    const detail = await octokitGateway(octokit).get('homeflare-kit', 7);

    expect(detail.bypassActors).toEqual([{ actor_type: 'Team', actor_id: 1 }]);
    expect(detail.requiredStatusChecksRule).toEqual({
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'ci' }],
      },
    });
    // ⛔ THE MINOR THIS GUARDS. "creation" is a rule type this script does not manage —
    //   an UPDATE removes it, and this is where that fact becomes knowable, not silent.
    expect(detail.foreignRuleTypes).toEqual(['creation']);
    expect(detail.htmlUrl).toBe('https://github.com/taslabs-net/x/rules/7');
  });

  test('get() treats a required_status_checks rule with no parameters as absent', async () => {
    const { octokit } = fakeOctokit({
      getResponse: {
        id: 7,
        name: 'main',
        bypass_actors: [],
        rules: [{ type: 'required_status_checks' }],
        _links: undefined,
      },
    });

    const detail = await octokitGateway(octokit).get('homeflare-kit', 7);

    expect(detail.requiredStatusChecksRule).toBeUndefined();
  });
});
