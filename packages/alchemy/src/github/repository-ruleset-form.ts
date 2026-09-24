/**
 * Props → wire form, and a canonical form for comparing two wire rulesets.
 *
 * ★ THE CANONICALIZATION IS THE NEVER-NOOP FIX. Upstream `GitHub.Ruleset#reconcile` compares
 *   `desired` against the live GET with a raw `deepEqual` (see repository-ruleset.ts's header).
 *   GitHub does not promise to echo `rules`, `allowed_merge_methods` or `checks` back in
 *   request order, and a live `required_status_checks` check carries `integration_id: null`
 *   where the request never sent the key at all — so an unsorted, un-normalized comparison
 *   drifts against itself on every single plan. `canonicalizeWireRuleset` sorts every list that
 *   has no meaningful order and drops nullish `integration_id` before two wire rulesets are
 *   ever compared.
 */
import type {
  RepositoryRulesetProps,
  RepositoryRulesetPullRequestRule,
  RepositoryRulesetRules,
  RepositoryRulesetStatusChecksRule,
} from './repository-ruleset.ts';
import type { CreateRulesetBody, WireRule } from './repository-ruleset-constraints.ts';

/** Fixed, deterministic order — independent of the order keys were set on `props.rules` — so
 * two declarations of the same policy always produce the same wire array. */
const RULE_BUILD_ORDER = [
  'creation',
  'update',
  'deletion',
  'required_linear_history',
  'required_signatures',
  'non_fast_forward',
  'pull_request',
  'required_status_checks',
] as const;

function buildPullRequestRule(rule: RepositoryRulesetPullRequestRule): WireRule {
  return {
    type: 'pull_request',
    parameters: {
      required_approving_review_count: rule.requiredApprovingReviewCount ?? 0,
      dismiss_stale_reviews_on_push: rule.dismissStaleReviewsOnPush ?? false,
      require_code_owner_review: rule.requireCodeOwnerReview ?? false,
      require_last_push_approval: rule.requireLastPushApproval ?? false,
      required_review_thread_resolution: rule.requiredReviewThreadResolution ?? false,
      ...(rule.allowedMergeMethods === undefined
        ? {}
        : { allowed_merge_methods: [...rule.allowedMergeMethods] }),
      // Defaulted to `[]`, not omitted — GitHub's own GET always carries this key (empty when
      // unset), so omitting it here would make every live ruleset diff against itself forever.
      required_reviewers: (rule.requiredReviewers ?? []).map((r) => ({
        file_patterns: [...r.filePatterns],
        minimum_approvals: r.minimumApprovals,
        reviewer: { id: r.reviewer.actorId, type: r.reviewer.actorType },
      })),
      // Sent as declared, `true` or `false` (K1, 2026-09-23) — see repository-ruleset.ts's H15
      // for why this field exists here at all (Octokit, not distilled) and
      // repository-ruleset-wire.test.ts for whether Octokit forwards it untyped for both values.
      ...(rule.extraApprovalForUnattributedChanges === undefined
        ? {}
        : {
            require_extra_approval_for_unattributed_changes:
              rule.extraApprovalForUnattributedChanges,
          }),
    },
    // The extension field above has no home in Octokit's own rule union (H15) — the cast is
    // the only place that gap is bridged.
  } as WireRule;
}

function buildStatusChecksRule(rule: RepositoryRulesetStatusChecksRule): WireRule {
  return {
    type: 'required_status_checks',
    parameters: {
      required_status_checks: rule.checks.map((c) => ({
        context: c.context,
        ...(c.integrationId === undefined ? {} : { integration_id: c.integrationId }),
      })),
      strict_required_status_checks_policy: rule.strictRequiredStatusChecksPolicy ?? false,
      do_not_enforce_on_create: rule.doNotEnforceOnCreate ?? false,
    },
  };
}

export function buildWireRules(rules: RepositoryRulesetRules | undefined): WireRule[] {
  const wire: WireRule[] = [];
  for (const type of RULE_BUILD_ORDER) {
    switch (type) {
      case 'creation':
        if (rules?.creation) wire.push({ type: 'creation' });
        break;
      case 'update':
        if (rules?.update) {
          wire.push({ type: 'update', parameters: { update_allows_fetch_and_merge: false } });
        }
        break;
      case 'deletion':
        if (rules?.deletion) wire.push({ type: 'deletion' });
        break;
      case 'required_linear_history':
        if (rules?.requiredLinearHistory) wire.push({ type: 'required_linear_history' });
        break;
      case 'required_signatures':
        if (rules?.requiredSignatures) wire.push({ type: 'required_signatures' });
        break;
      case 'non_fast_forward':
        if (rules?.nonFastForward) wire.push({ type: 'non_fast_forward' });
        break;
      case 'pull_request':
        if (rules?.pullRequest) wire.push(buildPullRequestRule(rules.pullRequest));
        break;
      case 'required_status_checks':
        if (rules?.requiredStatusChecks) {
          wire.push(buildStatusChecksRule(rules.requiredStatusChecks));
        }
        break;
    }
  }
  return wire;
}

/** The full desired wire body, minus `owner`/`repo` — sent verbatim to `createRepoRuleset` or
 * `updateRepoRuleset`. */
export function desiredWireRuleset(props: RepositoryRulesetProps): CreateRulesetBody {
  return {
    name: props.name,
    target: props.target ?? 'branch',
    enforcement: props.enforcement ?? 'active',
    bypass_actors: (props.bypassActors ?? []).map((a) => ({
      actor_type: a.actorType,
      // `exactOptionalPropertyTypes`: an always-present `actor_id: number | undefined` is not
      // assignable to the wire's `actor_id?: number | null` — the key must be ABSENT, not
      // present-with-`undefined`, when there is no id.
      ...(a.actorId === undefined ? {} : { actor_id: a.actorId }),
      bypass_mode: a.bypassMode ?? 'always',
    })),
    conditions: {
      ref_name: {
        include: [...(props.conditions?.include ?? ['~ALL'])].sort(),
        exclude: [...(props.conditions?.exclude ?? [])].sort(),
      },
    },
    rules: buildWireRules(props.rules),
  };
}

const sortByJson = <T>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Drop keys whose value is `null` or `undefined`, recursively — GitHub's GET fills
 * `integration_id: null` where the request never sent the key; this makes both read the same. */
/**
 * ⚠️ SORTS OBJECT KEYS TOO, NOT ONLY ARRAY ELEMENTS. `JSON.stringify` preserves insertion
 *   order, so `{a:1,b:2}` and `{b:2,a:1}` stringify to different text despite being the same
 *   value — measured directly by this file's own lifecycle test: `desiredWireRuleset` and a
 *   fixture built by spreading `{...liveRule, ...patch}` produced `parameters` keys in two
 *   different orders and every downstream `JSON.stringify` equality check failed although the
 *   values were identical. Sorting keys here is what makes the `JSON.stringify(canonicalize(x))
 *   === JSON.stringify(canonicalize(y))` comparisons the rest of this family relies on
 *   (repository-ruleset-reconcile.ts, and every canonicalize-based test) actually compare
 *   VALUES rather than incidental key order.
 */
function stripNullish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullish);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== null && v !== undefined) out[k] = stripNullish(v);
    }
    return out;
  }
  return value;
}

function canonicalizeRule(rule: Record<string, unknown>): Record<string, unknown> {
  const stripped = stripNullish(rule) as Record<string, unknown>;
  const params = stripped.parameters as Record<string, unknown> | undefined;
  if (params === undefined) return stripped;
  const next = { ...params };
  if (Array.isArray(next.allowed_merge_methods)) {
    next.allowed_merge_methods = [...(next.allowed_merge_methods as string[])].sort();
  }
  if (Array.isArray(next.required_status_checks)) {
    next.required_status_checks = sortByJson(
      next.required_status_checks as Record<string, unknown>[],
    );
  }
  return { ...stripped, parameters: next };
}

/**
 * Normalize a wire ruleset (desired OR observed) so two representations of the same policy
 * compare equal regardless of the order GitHub happens to echo lists back in.
 *
 * ⚠️ `input: unknown`, DELIBERATELY, NOT `CreateRulesetBody | RulesetRecord`. The two real
 *   callers (our own request body, and GitHub's JSON response) are independently typed and
 *   under `exactOptionalPropertyTypes` a shared structural interface fights both of them at
 *   once for no safety this function actually uses — every field below is read defensively,
 *   the same way a live GET already has to be, so a typed façade here would be decorative.
 */
export function canonicalizeWireRuleset(input: unknown): unknown {
  const r = (input ?? {}) as {
    name?: unknown;
    target?: unknown;
    enforcement?: unknown;
    bypass_actors?: readonly Record<string, unknown>[];
    conditions?: unknown;
    rules?: readonly Record<string, unknown>[];
  };
  return stripNullish({
    name: r.name,
    target: r.target ?? 'branch',
    enforcement: r.enforcement,
    bypass_actors: sortByJson(r.bypass_actors ?? []),
    conditions: r.conditions,
    rules: sortByJson((r.rules ?? []).map(canonicalizeRule)),
  });
}
