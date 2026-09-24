/**
 * `GitHub.RepositoryRuleset`'s declared shape — split out of repository-ruleset.ts purely to
 * keep that file (the provider wiring) under the 250-line cap; nothing here is provider logic.
 */
import type { RulesetProps } from 'alchemy/GitHub';

type UpstreamRules = NonNullable<RulesetProps['rules']>;

export interface RepositoryRulesetReviewerRule {
  readonly filePatterns: readonly string[];
  readonly minimumApprovals: number;
  readonly reviewer: { readonly actorId: number; readonly actorType: 'Team' };
}

export interface RepositoryRulesetPullRequestRule extends NonNullable<
  UpstreamRules['pullRequest']
> {
  /** @default every method GitHub allows — the house baseline always pins `['squash']`. */
  readonly allowedMergeMethods?: readonly ('merge' | 'squash' | 'rebase')[];
  readonly requiredReviewers?: readonly RepositoryRulesetReviewerRule[];
  /** `require_extra_approval_for_unattributed_changes` — see repository-ruleset.ts's H15. Only
   * `false` is modeled: sending `true` has no house use, and GitHub already defaults absent to
   * `true`. */
  readonly extraApprovalForUnattributedChanges?: false;
}

export interface RepositoryRulesetStatusChecksRule extends NonNullable<
  UpstreamRules['requiredStatusChecks']
> {
  readonly doNotEnforceOnCreate?: boolean;
}

export interface RepositoryRulesetRules extends Omit<
  UpstreamRules,
  'pullRequest' | 'requiredStatusChecks'
> {
  /** `undefined`: no opinion (refused if the live ruleset already has one and this is not an
   * exact-adopt pass-through — see repository-ruleset-guards.ts's `undeclaredLiveRuleRefusal`).
   * `false`: declare its ABSENCE — either "this repo never had one" (a create, or an adopt
   * where live already has none, both no-ops) or a deliberate removal of a live rule, which
   * `ruleNarrowingRefusal` gates behind `acknowledgeNarrowing` (see below). Added 2026-09-23 for
   * exact-adopt pass-through: `requiredStatusChecks` already had this `false` escape; `deletion`/
   * `nonFastForward`/etc already have it implicitly (plain `boolean`, so `false` is already a
   * value); `pullRequest` was the one modeled rule with NO way to express "not present at all" —
   * a repo like `taslabs-net/taslabs-net` (measured live 2026-09-23: `rules = [deletion,
   * non_fast_forward]`, no `pull_request`) could not be adopted through this resource without
   * either refusing to omit the key (a type error) or silently declaring a brand-new rule. */
  readonly pullRequest?: RepositoryRulesetPullRequestRule | false;
  /** `undefined`: no opinion (refused if the live ruleset already has one — see
   * repository-ruleset-guards.ts). `false`: declare its ABSENCE — removes a live one. */
  readonly requiredStatusChecks?: RepositoryRulesetStatusChecksRule | false;
}

export interface RepositoryRulesetProps extends Omit<RulesetProps, 'rules'> {
  readonly rules?: RepositoryRulesetRules;
  /**
   * An explicit, reasoned sign-off that THIS declaration deliberately narrows live protection —
   * drops a live bypass actor (`bypassActors` is a strict subset of what is live) or drops a
   * live rule (a modeled rule type is declared `false`/boolean-`false` while the live ruleset
   * still has it). Without this, `reconcile` refuses the write rather than silently loosen a
   * ruleset that already protects something — see `bypassNarrowingRefusal`/`ruleNarrowingRefusal`
   * in repository-ruleset-narrowing-guards.ts. `reason` is not logged or sent to GitHub; it
   * exists so the declaration's own diff carries WHY, for the next reader (S21: a refusal names
   * the fact it checked — this is the human-authored counterpart for the one case a fact alone
   * cannot settle: "is this narrowing intentional?").
   *
   * ⛔ THIS IS A STANDING PROP, NOT A ONE-TIME TOKEN — remove it from the declaration once the
   *   narrowing it describes has landed. Left in place, it keeps disabling BOTH narrowing guards
   *   for every future `reconcile` of this resource, not only the change it was written for —
   *   the same way `rules: { deletion: false }` stays a standing "this rule stays absent" fact
   *   rather than a one-time action, only here the standing fact is "narrowing needs no review",
   *   which is a fact you want true for as short a window as possible. A reviewer reading a diff
   *   that adds a SECOND, unrelated narrowing under an OLD `acknowledgeNarrowing` left over from
   *   a prior change is the failure mode this note exists to head off.
   */
  readonly acknowledgeNarrowing?: { readonly reason: string };
}
