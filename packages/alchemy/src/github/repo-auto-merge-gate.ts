/**
 * `gateAutoMergeOnRuleset` — the one place `declareRepoBaseline` and `declareRepoPolicy` thread
 * a real apply-ordering edge from `GitHub.Repository`'s `allowAutoMerge` to the sibling
 * `RepositoryRuleset`, so a deploy can never turn auto-merge on before the ruleset's required
 * checks/approvals are actually live.
 *
 * ⛔ K5 (kit PR 216, 2026-09-24): both callers declare `GitHub.Repository` and `RepositoryRuleset`
 *   as two INDEPENDENT resources with no dependency edge between them. When a repo moves from
 *   `checks:[]` to `checks:['x']`, `allowAutoMerge` flips to `true` in the very same deploy that
 *   adds the required check. If the Repository apply lands before the Ruleset apply — or the
 *   Ruleset apply fails outright — the repo ends up with auto-merge on and nothing required: `gh
 *   pr merge --auto` merges a CLEAN pull request immediately (memory `gh-auto-merge-merges-now`).
 *   That fail-open state is exactly what K5 exists to prevent.
 *
 * ★ THE MECHANISM — ALCHEMY ORDERS BY OUTPUT REFERENCES IN PROPS, NOT DECLARATION ORDER.
 *   `Plan.ts` (~l.1031-1038): a resource's upstream deps are `Output.upstreamAny(resource.Props)`.
 *   `Apply.ts` (~l.760-762, ~l.909): `waitForDeps(allUpstreamFqns())` — built the same way from
 *   `Output.resolveUpstream(node.props)` — runs before `reconcile`. See the kit's own
 *   `alchemy-output-refs-order-resources` memory. `GitHub.Repository`'s upstream `RepositoryProps`
 *   has no spare field: `reconcile` (`node_modules/alchemy/src/GitHub/Repository.ts`) sends every
 *   declared prop straight to Octokit's create/update calls, so there is nothing to smuggle an
 *   unrelated Output into. `allowAutoMerge` itself is the vehicle instead: its value is still
 *   exactly `true` whenever this function is called with it already `true` — only now computed
 *   AFTER `ruleset.rulesetId` resolves via `Output.map`, instead of written as a literal. That
 *   single Output reference is enough for `Output.upstreamAny` to record the ruleset as this
 *   Repository's upstream dependency, so the engine applies the ruleset first.
 *
 * ★ WHY THIS NEEDS NO REVERSE-DIRECTION EDGE. The opposite transition — checks/approvals
 *   REMOVED, so `allowAutoMerge` turns off — cannot silently race the other way. Neither caller
 *   ever declares `rules.requiredStatusChecks: false` or omits `rules.pullRequest` on purpose;
 *   dropping `checks`/`requiredApprovals` from the options just OMITS the corresponding rule key.
 *   `requiredChecksOmissionRefusal` and `undeclaredLiveRuleRefusal` (repository-ruleset-guards.ts)
 *   both refuse — unconditionally, regardless of apply order — to drop a rule that is still LIVE
 *   by omission. So the worst reachable state, whichever resource applies first, is: Repository
 *   succeeds (auto-merge off, the correct direction anyway) and Ruleset refuses (the live rule
 *   stays required) — never fail-open. Proved by the ordering/failure tests beside this file.
 */
import * as Output from 'alchemy/Output';

/** The one attribute this gate needs from a declared `RepositoryRuleset`. */
export interface AutoMergeGateSource {
  readonly rulesetId: Output.Output<number, never>;
}

/**
 * Returns `settings` unchanged when `allowAutoMerge` is falsy — nothing to gate, and every
 * existing declaration with auto-merge off keeps its exact prior props (no diff, no replan).
 * Otherwise returns `settings` with `allowAutoMerge` recomputed as an Output.map over
 * `ruleset.rulesetId` — still resolves to `true`, now with a real dependency edge attached.
 */
export function gateAutoMergeOnRuleset<P extends { readonly allowAutoMerge?: boolean }>(
  settings: P,
  ruleset: AutoMergeGateSource,
): P | (Omit<P, 'allowAutoMerge'> & { readonly allowAutoMerge: Output.Output<boolean, never> }) {
  if (!settings.allowAutoMerge) return settings;
  return { ...settings, allowAutoMerge: Output.map(ruleset.rulesetId, () => true) };
}
