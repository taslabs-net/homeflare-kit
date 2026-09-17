/**
 * The `main` ruleset's shape, and the `@octokit/rest` adapter that applies it.
 *
 * ★ THE SHAPE BELOW IS NOT INVENTED. It is `taslabs-net/homeflare-kit`'s live ruleset,
 *   read via `gh api repos/taslabs-net/homeflare-kit/rulesets/23471358` on 2026-09-16:
 *   `deletion` + `non_fast_forward` + a solo-approval `pull_request` rule with stale
 *   reviews dismissed on push, `bypass_actors: []`. See docs/github-hygiene.md.
 *
 * ⛔ Split from scripts/apply-main-ruleset.ts so that file stays under the 250-line cap —
 *   this one owns the GitHub-shaped types and the SDK call, that one owns the upsert
 *   decision and the CLI.
 */
import type { Octokit } from '@octokit/rest';

export const OWNER = 'taslabs-net';
export const RULESET_NAME = 'main';

export interface PullRequestRuleParameters {
  readonly required_approving_review_count: number;
  readonly dismiss_stale_reviews_on_push: boolean;
  readonly required_reviewers: readonly unknown[];
  readonly require_code_owner_review: boolean;
  readonly require_last_push_approval: boolean;
  readonly required_review_thread_resolution: boolean;
  readonly require_extra_approval_for_unattributed_changes: boolean;
  readonly allowed_merge_methods: readonly ('merge' | 'squash' | 'rebase')[];
}

export interface RequiredStatusChecksParameters {
  readonly strict_required_status_checks_policy: boolean;
  readonly do_not_enforce_on_create: boolean;
  readonly required_status_checks: readonly { readonly context: string }[];
}

export type RulesetRule =
  | { readonly type: 'deletion' }
  | { readonly type: 'non_fast_forward' }
  | { readonly type: 'pull_request'; readonly parameters: PullRequestRuleParameters }
  | {
      readonly type: 'required_status_checks';
      readonly parameters: RequiredStatusChecksParameters;
    };

export interface BypassActor {
  readonly actor_id?: number | null | undefined;
  readonly actor_type: string;
  readonly bypass_mode?: string | undefined;
}

export interface RulesetPayload {
  readonly name: string;
  readonly target: 'branch';
  readonly enforcement: 'active';
  readonly bypass_actors: readonly BypassActor[];
  readonly conditions: {
    readonly ref_name: { readonly include: readonly string[]; readonly exclude: readonly string[] };
  };
  readonly rules: readonly RulesetRule[];
}

export interface RulesetSummary {
  readonly id: number;
  readonly name: string;
  readonly target?: string | undefined;
}

export interface RulesetDetail {
  readonly id: number;
  readonly name: string;
  readonly bypassActors?: readonly BypassActor[] | undefined;
  readonly htmlUrl?: string | undefined;
}

/** One rule per `type`, kept exhaustive so a new `RulesetRule` variant fails to compile here. */
export function describeRule(rule: RulesetRule): string {
  switch (rule.type) {
    case 'deletion':
      return 'no branch deletion';
    case 'non_fast_forward':
      return 'no force pushes';
    case 'pull_request':
      return `PR required, ${rule.parameters.required_approving_review_count} approval(s), stale reviews dismissed on push`;
    case 'required_status_checks':
      return `required checks: ${rule.parameters.required_status_checks.map((c) => c.context).join(', ')}`;
    default: {
      const exhaustive: never = rule;
      throw new Error(`unhandled rule type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** `undefined` means OFF — no `required_status_checks` rule at all, ever, by default. */
export function buildRules(requiredChecks: readonly string[] | undefined): readonly RulesetRule[] {
  const rules: RulesetRule[] = [
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
  ];

  if (requiredChecks !== undefined) {
    rules.push({
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: requiredChecks.map((context) => ({ context })),
      },
    });
  }

  return rules;
}

export function buildPayload(
  requiredChecks: readonly string[] | undefined,
  bypassActors: readonly BypassActor[],
): RulesetPayload {
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: bypassActors,
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: buildRules(requiredChecks),
  };
}

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

function toDetail(data: {
  readonly id: number;
  readonly name: string;
  readonly bypass_actors?: readonly BypassActor[] | null;
  readonly _links?: { readonly html?: { readonly href?: string } | null } | null;
}): RulesetDetail {
  return {
    id: data.id,
    name: data.name,
    bypassActors: data.bypass_actors ?? undefined,
    htmlUrl: data._links?.html?.href,
  };
}

export function octokitGateway(octokit: Octokit): RulesetGateway {
  return {
    list: async (repo) => {
      const { data } = await octokit.rest.repos.getRepoRulesets({ owner: OWNER, repo });
      return data;
    },
    get: async (repo, ruleset_id) => {
      const { data } = await octokit.rest.repos.getRepoRuleset({ owner: OWNER, repo, ruleset_id });
      return toDetail(data);
    },
    create: async (repo, payload) => {
      const { data } = await octokit.rest.repos.createRepoRuleset({
        owner: OWNER,
        repo,
        ...payload,
      } as Parameters<typeof octokit.rest.repos.createRepoRuleset>[0]);
      return toDetail(data);
    },
    update: async (repo, ruleset_id, payload) => {
      const { data } = await octokit.rest.repos.updateRepoRuleset({
        owner: OWNER,
        repo,
        ruleset_id,
        ...payload,
      } as Parameters<typeof octokit.rest.repos.updateRepoRuleset>[0]);
      return toDetail(data);
    },
  };
}
