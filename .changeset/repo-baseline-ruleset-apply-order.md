---
'@homeflare/alchemy': patch
---

`declareRepoBaseline` and `declareRepoPolicy` declared `GitHub.Repository` and their
`RepositoryRuleset` as two independent resources with no dependency edge between them (K5,
kit PR 216). `repoBaselineSettings`/`repoPolicy` already gate `allowAutoMerge` on
`checks.length > 0`, but with nothing ordering the two resources, a deploy that moves a repo
from `checks: []` to a non-empty list could apply the repository (turning auto-merge on) before
the ruleset (adding the required check) — or the ruleset apply could fail outright, leaving
auto-merge on with nothing required. `gh pr merge --auto` merges a CLEAN pull request the instant
nothing is outstanding, so that window is exactly the fail-open state K5 exists to prevent.

Both callers now thread the ruleset's `rulesetId` through `allowAutoMerge`'s own value
(`repo-auto-merge-gate.ts`'s `gateAutoMergeOnRuleset`, via `alchemy/Output`'s `map`) whenever a
declaration turns auto-merge on, instead of writing it as a literal. Alchemy orders resources by
Output references in props (`Plan.ts`'s `Output.upstreamAny`, `Apply.ts`'s `waitForDeps` —
see the kit's own `alchemy-output-refs-order-resources` memory), so this makes the engine apply
the ruleset first, with no change to the value actually sent (`allowAutoMerge` is still exactly
`true`). A ruleset apply failure now leaves the repository's `reconcile` — and `allowAutoMerge`
— untouched, proved by a new engine-level ordering test and failure test for each caller.

The reverse transition (checks/approvals removed) needs no matching edge: neither caller ever
declares a rule's removal explicitly, only omits it, and `repository-ruleset-guards.ts`'s
`requiredChecksOmissionRefusal`/`undeclaredLiveRuleRefusal` already refuse — regardless of apply
order — to drop a still-live required rule by omission.

Known trade-off (found by adversarial review, 2026-09-24): forcing the ruleset first only helps
once the repository already exists. A repo and its ruleset created together for the FIRST time,
with `checks` non-empty from day one, now fails clearly instead of racing — GitHub's own ruleset
API 404s on a repository that does not exist yet, and the engine now guarantees that order rather
than leaving it to chance. Both `declareRepoBaseline` and `declareRepoPolicy` document this and a
new test proves the failure is explicit, not a silent fail-open; the fix is for an ALREADY-LIVE
repo moving from no checks to some, which is K5's own scenario and the documented use of both
functions.
