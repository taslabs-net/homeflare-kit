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
   * `ruleNarrowingRefusal` gates behind `acknowledgeRuleNarrowing` (see below). Added 2026-09-23 for
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
   * An explicit, reasoned sign-off that THIS declaration deliberately drops a live bypass actor
   * (`bypassActors` is a strict subset of what is live). Without this, `reconcile` refuses the
   * write rather than silently loosen a ruleset that already protects something — see
   * `bypassNarrowingRefusal` in repository-ruleset-narrowing-guards.ts. `reason` is not logged or
   * sent to GitHub; it exists so the declaration's own diff carries WHY, for the next reader
   * (S21: a refusal names the fact it checked — this is the human-authored counterpart for the
   * one case a fact alone cannot settle: "is this narrowing intentional?").
   *
   * ⛔ SEPARATE FROM `acknowledgeRuleNarrowing` ON PURPOSE (2026-09-23 review finding: a single
   *   shared `acknowledgeNarrowing` let one reason worded for a rule drop silently also rubber-
   *   stamp an unrelated bypass-actor drop in the SAME declaration — a `bypassActors: []` left
   *   over from an unrelated edit slipped through under a reason that never mentioned bypass at
   *   all). Each prop authorizes only the narrowing its own guard checks; a declaration that
   *   narrows both needs both, each with its own reason.
   *
   * ⛔ ALSO A STANDING PROP, NOT A ONE-TIME TOKEN — remove it from the declaration once the
   *   narrowing it describes has landed. Left in place, it keeps disabling the bypass-narrowing
   *   guard for every future `reconcile` of this resource, not only the change it was written
   *   for — the same way `rules: { deletion: false }` stays a standing "this rule stays absent"
   *   fact rather than a one-time action, only here the standing fact is "bypass narrowing needs
   *   no review", which is a fact you want true for as short a window as possible. A reviewer
   *   reading a diff that adds a SECOND, unrelated bypass drop under an OLD
   *   `acknowledgeBypassNarrowing` left over from a prior change is the failure mode this note
   *   exists to head off.
   */
  readonly acknowledgeBypassNarrowing?: { readonly reason: string };
  /**
   * The `rules`-side counterpart to `acknowledgeBypassNarrowing` above — an explicit, reasoned
   * sign-off that THIS declaration deliberately drops a live rule (a modeled rule type declared
   * `false`/boolean-`false` while the live ruleset still has it). Without this, `reconcile`
   * refuses the write — see `ruleNarrowingRefusal` in repository-ruleset-narrowing-guards.ts.
   * Same standing-prop caution as `acknowledgeBypassNarrowing`: remove it once the rule drop it
   * describes has landed, or it keeps excusing every later rule drop on this resource too.
   */
  readonly acknowledgeRuleNarrowing?: { readonly reason: string };
}
