/**
 * The `@octokit/rest` adapter for the `main` ruleset. Split from scripts/github-ruleset.ts
 * (the rule shapes and update logic) to stay under the 250-line file cap — see AGENTS.md.
 */
import type { Octokit } from '@octokit/rest';
import { assertSoloApprovals } from './github-ruleset-approval.ts';
import {
  OWNER,
  type RulesetDetail,
  type RulesetPayload,
  type RulesetSummary,
  toDetail,
} from './github-ruleset.ts';

/**
 * The seam `apply-main-ruleset.ts` tests through: a fake `RulesetGateway` makes the
 * upsert logic testable with no live GitHub writes, while this is the only place that
 * actually calls `@octokit/rest` — GitHub's official SDK, never a hand-rolled `fetch`.
 */
export interface RulesetGateway {
  readonly list: (repo: string) => Promise<readonly RulesetSummary[]>;
  readonly get: (repo: string, rulesetId: number) => Promise<RulesetDetail>;
  readonly create: (repo: string, payload: RulesetPayload) => Promise<RulesetDetail>;
  readonly update: (
    repo: string,
    rulesetId: number,
    payload: RulesetPayload,
  ) => Promise<RulesetDetail>;
}

export function octokitGateway(octokit: Octokit): RulesetGateway {
  // ⛔ Read independently of the write response: report success only after GitHub
  // confirms the persisted policy, including the schema's missing approval flag.
  const verified = async (repo: string, ruleset_id: number): Promise<RulesetDetail> => {
    const { data } = await octokit.rest.repos.getRepoRuleset({ owner: OWNER, repo, ruleset_id });
    assertSoloApprovals(data.rules);
    return toDetail(data);
  };
  return {
    // ⛔ MUST PAGINATE. Unpaginated `getRepoRulesets` returns only the first page
    //   (default 30) — a duplicate "main" ruleset sitting on page 2 would be invisible to
    //   the caller, which is exactly the gap that let a plain `.find()` silently pick
    //   ONE ruleset instead of proving there was only one. `per_page: 100` keeps a repo
    //   with a sane number of rulesets to a single request; `octokit.paginate` walks
    //   every page regardless.
    list: async (repo) =>
      await octokit.paginate(octokit.rest.repos.getRepoRulesets, {
        owner: OWNER,
        repo,
        per_page: 100,
      }),
    get: async (repo, ruleset_id) => {
      const { data } = await octokit.rest.repos.getRepoRuleset({ owner: OWNER, repo, ruleset_id });
      return toDetail(data);
    },
    create: async (repo, payload) => {
      const { data } = await octokit.rest.repos.createRepoRuleset({
        owner: OWNER,
        repo,
        ...payload,
      });
      return await verified(repo, data.id);
    },
    update: async (repo, ruleset_id, payload) => {
      const { data } = await octokit.rest.repos.updateRepoRuleset({
        owner: OWNER,
        repo,
        ruleset_id,
        ...payload,
      });
      return await verified(repo, data.id);
    },
  };
}
