/**
 * The `main` ruleset's shape, and the `@octokit/rest` adapter that applies it.
 *
 * ★ THE SHAPE BELOW IS NOT INVENTED. It is `taslabs-net/homeflare-kit`'s live ruleset,
 *   read via `gh api repos/taslabs-net/homeflare-kit/rulesets/23471358` on 2026-09-16:
 *   `deletion` + `non_fast_forward` + a solo-approval `pull_request` rule with stale
 *   reviews dismissed on push, `bypass_actors: []`. See docs/github-hygiene.md.
 *
 * ⛔ EVERY TYPE BELOW IS DERIVED FROM `Octokit`'s OWN resolved method signatures
 *   (`typeof _octokit.rest.repos.X`), never hand-typed and never a separate
 *   `@octokit/openapi-types` import. Measured 2026-09-16: this tree pins TWO versions of
 *   that package transitively (27.0.0 and 29.0.1), so importing it directly can silently
 *   reconcile against a DIFFERENT schema than the one `octokit.rest.repos.X` actually
 *   uses at runtime — worse than no reconciliation at all. Deriving from the live method
 *   itself is the only way the types can never drift from what `@octokit/rest` sends.
 * ⛔ `Pick`-by-NAME, never `Omit`, for `RulesetPayload`. Octokit's params type is
 *   `RequestParameters & {...}`, and `RequestParameters` carries a `[k: string]: unknown`
 *   index signature — intersected in, that collapses `keyof` to plain `string`, so
 *   `Omit<T, 'owner' | 'repo'>` silently degrades to a type `{}` is assignable to.
 *   Measured 2026-09-16: `bun run types` passed on that version and the resulting
 *   "typed" payload had NO required fields at all. `Pick`-by-name sidesteps `keyof`
 *   entirely and keeps `name`/`enforcement` genuinely required.
 * ★ The payoff: `octokit.rest.repos.createRepoRuleset({ owner, repo, ...payload })`
 *   below type-checks with NO cast — a field this script does not model (like
 *   `require_extra_approval_for_unattributed_changes`, which the installed schema does
 *   not accept on write despite GitHub returning it on read) fails to COMPILE rather
 *   than being silently sent.
 */
import type { Octokit } from '@octokit/rest';

export const OWNER = 'taslabs-net';
export const RULESET_NAME = 'main';

declare const _octokit: Octokit;
type CreateParams = NonNullable<Parameters<typeof _octokit.rest.repos.createRepoRuleset>[0]>;
type AnyRule = NonNullable<CreateParams['rules']>[number];
type RuleOfType<T extends AnyRule['type']> = Extract<AnyRule, { type: T }>;
/** Every rule this script builds always sends `parameters`, even where the schema allows omitting it. */
type RequireParameters<T> = T extends { parameters?: infer P }
  ? Omit<T, 'parameters'> & { readonly parameters: NonNullable<P> }
  : T;

export type RulesetRule =
  | RequireParameters<RuleOfType<'deletion'>>
  | RequireParameters<RuleOfType<'non_fast_forward'>>
  | RequireParameters<RuleOfType<'pull_request'>>
  | RequireParameters<RuleOfType<'required_status_checks'>>;

export type PullRequestRuleParameters = Extract<
  RulesetRule,
  { type: 'pull_request' }
>['parameters'];
export type RequiredStatusChecksParameters = Extract<
  RulesetRule,
  { type: 'required_status_checks' }
>['parameters'];

export type BypassActor = NonNullable<CreateParams['bypass_actors']>[number];
export type RulesetPayload = Pick<
  CreateParams,
  'name' | 'target' | 'enforcement' | 'bypass_actors' | 'conditions' | 'rules'
>;

type ListItem = Awaited<ReturnType<typeof _octokit.rest.repos.getRepoRulesets>>['data'][number];
export type RulesetSummary = Pick<ListItem, 'id' | 'name' | 'target'>;

type GetData = Awaited<ReturnType<typeof _octokit.rest.repos.getRepoRuleset>>['data'];
export interface RulesetDetail {
  readonly id: number;
  readonly name: string;
  readonly bypassActors: readonly BypassActor[];
  /** The LIVE `required_status_checks` rule, if this ruleset has one — `undefined` means none. */
  readonly requiredStatusChecksRule: RulesetRule | undefined;
  readonly htmlUrl: string | undefined;
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

/** The 3 rules this script always converges to the gold standard — create, update, every time. */
export function buildOwnedRules(): readonly RulesetRule[] {
  return [
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
  ];
}

export function buildRequiredStatusChecksRule(requiredChecks: readonly string[]): RulesetRule {
  return {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: requiredChecks.map((context) => ({ context })),
    },
  };
}

/** CREATE path only. A brand-new ruleset has no existing state, so `undefined` truly means OFF. */
export function buildRules(requiredChecks: readonly string[] | undefined): readonly RulesetRule[] {
  const owned = buildOwnedRules();
  return requiredChecks === undefined
    ? owned
    : [...owned, buildRequiredStatusChecksRule(requiredChecks)];
}

/**
 * UPDATE path only. ⛔ Omitting `--require-checks` must PRESERVE whatever
 * `required_status_checks` rule is live right now, exactly — not rebuild it, not drop
 * it. A plain rerun of this script must never be the thing that silently turns required
 * checks off on a repo that already has them. `requiredChecks` explicit always replaces.
 */
export function resolveRulesForUpdate(
  requiredChecks: readonly string[] | undefined,
  currentRequiredStatusChecksRule: RulesetRule | undefined,
): readonly RulesetRule[] {
  const owned = buildOwnedRules();
  if (requiredChecks !== undefined)
    return [...owned, buildRequiredStatusChecksRule(requiredChecks)];
  return currentRequiredStatusChecksRule === undefined
    ? owned
    : [...owned, currentRequiredStatusChecksRule];
}

export function buildPayload(
  rules: readonly RulesetRule[],
  bypassActors: readonly BypassActor[],
): RulesetPayload {
  return {
    name: RULESET_NAME,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [...bypassActors],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    rules: [...rules],
  };
}

function currentRequiredStatusChecksRule(
  rules: readonly AnyRule[] | undefined,
): RulesetRule | undefined {
  const found = (rules ?? []).find((r) => r.type === 'required_status_checks');
  // A rule with no `parameters` cannot be preserved exactly, so treat it as absent —
  // the same "no rule" state a repo with none at all is in.
  return found?.parameters === undefined
    ? undefined
    : { type: 'required_status_checks', parameters: found.parameters };
}

function toDetail(data: GetData): RulesetDetail {
  return {
    id: data.id,
    name: data.name,
    bypassActors: data.bypass_actors ?? [],
    requiredStatusChecksRule: currentRequiredStatusChecksRule(data.rules),
    htmlUrl: data._links?.html?.href,
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

export function octokitGateway(octokit: Octokit): RulesetGateway {
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
      return toDetail(data);
    },
    update: async (repo, ruleset_id, payload) => {
      const { data } = await octokit.rest.repos.updateRepoRuleset({
        owner: OWNER,
        repo,
        ruleset_id,
        ...payload,
      });
      return toDetail(data);
    },
  };
}
