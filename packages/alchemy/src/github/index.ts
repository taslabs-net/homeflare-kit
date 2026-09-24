/**
 * GitHub helpers for Alchemy — one repository's house policy in one call, and (2026-09-23) the
 * one bridge resource this house builds atop upstream GitHub: `GitHub.RepositoryRuleset`.
 *
 * ⚠️ `declareRepoPolicy`/`declareRepoBaseline` COMPOSE UPSTREAM `GitHub.Repository` PLUS THIS
 *   SUBPATH'S OWN `RepositoryRulesetProvider()` — provide BOTH `GitHub.providers()` and
 *   `RepositoryRulesetProvider()`. Before 2026-09-23 this subpath shipped no provider at all,
 *   composing only vendor resources; `RepositoryRuleset` is the one exception, and
 *   repository-ruleset.ts's header says why upstream's own `Ruleset` cannot fill the gap.
 * ★ WHY THE POLICY HELPERS EXIST. "Open a pull request, let auto-merge land it" is safe only
 *   when five repository properties and four ruleset rules all agree, and every way of getting
 *   one of them wrong is silent — an auto-merge that lands on red, a force push that rewrites
 *   the branch a release tagged, a required context nothing ever reports. One call puts the
 *   whole policy in one place, and one place is where it gets fixed.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API. `repo-policy-form.ts`, `repository-ruleset-form.ts` and the
 *   rest of the `repository-ruleset-*` internals are reachable by path if you genuinely need
 *   one — a deliberate act rather than an accident of barrelling.
 */
export {
  type RepoPolicy,
  type RepoPolicyBypassActor,
  type RepoPolicyOptions,
  type RepoPolicyRepositorySettings,
  repoPolicy,
} from './repo-policy-form.ts';
export { type DeclareRepoPolicyOptions, declareRepoPolicy } from './repo-policy.ts';
export {
  type RepoBaselineInput,
  PUBLIC_ONLY_UNDECLARABLE,
  repoBaselineRuleset,
  repoBaselineSettings,
} from './repo-baseline-data.ts';
export { type DeclareRepoBaselineOptions, declareRepoBaseline } from './declare-repo-baseline.ts';
export {
  RepositoryRuleset,
  RepositoryRulesetProvider,
  type RepositoryRulesetAttributes,
  type RepositoryRulesetProps,
  type RepositoryRulesetPullRequestRule,
  type RepositoryRulesetReviewerRule,
  type RepositoryRulesetRules,
  type RepositoryRulesetStatusChecksRule,
} from './repository-ruleset.ts';
export { RULE_TYPE_COVERAGE, type RepositoryRuleType } from './repository-ruleset-constraints.ts';
export {
  BypassActorNarrowed,
  BypassActorWidened,
  DuplicateRuleset,
  NeverReportedContext,
  ReadbackMismatch,
  RequiredChecksOmitted,
  RuleNarrowed,
  RulesetConstraintRefused,
  UndeclaredLiveRule,
  type RepositoryRulesetError,
} from './repository-ruleset-errors.ts';
