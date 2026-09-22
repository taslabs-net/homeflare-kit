---
'@homeflare/alchemy': minor
---

**New subpath: `@homeflare/alchemy/github` — one repository's merge policy in one call.**

- `declareRepoPolicy(id, options)` declares a `GitHub.Repository` and a `GitHub.Ruleset` over its
  default branch: squash-only merges, auto-merge, head branches deleted on merge, no branch
  deletion, no force pushes, and the status-check contexts you name required with
  `strict_required_status_checks_policy` off. Both resources retain; `adopt` is piped only when
  asked. Generic and parameterized — `rulesetName`, `include`/`exclude`, `bypassActors`,
  `enforcement`, `baseUrl` (applied to both resources or to neither), and a `settings` bag for
  everything that is not merge policy, merged underneath so it cannot re-open a merge method.
- `repoPolicy(options)` is the same policy as two plain prop objects, pure and type-only, for a
  test or a stack that wants to declare the resources itself.

What it refuses, because each of these failures is silent:

- ⛔ **Auto-merge with nothing to wait for merges the pull request immediately.** Auto-merge is
  a queue only while something is outstanding, and three inputs produce "nothing
  outstanding": no `checks` and no `requiredApprovals`; an `enforcement` that is not `active`
  (the rules are listed and none of them block); and an explicitly empty `include` (the ruleset
  matches no ref while GitHub still shows it as active). A required review counts as outstanding,
  so `requiredApprovals` with an empty `checks` is allowed. `checks: []` alone is accepted only
  alongside `autoMerge: false` — the honest description of a repo with no green run to require yet.
- ⛔ **A blank check context** is refused: GitHub stores it and no job ever reports it, so every
  pull request waits on a check that cannot come.
- ⛔ **`requiredApprovals: 0` is refused rather than treated as "no reviews".** Zero approvals is
  the solo-maintainer shape and needs `require_extra_approval_for_unattributed_changes: false`,
  which `alchemy@2.0.0-beta.79`'s `Ruleset` cannot send and GitHub defaults to `true`. Omitting
  `requiredApprovals` declares no `pull_request` rule at all, which is a different and honest
  thing.

⚠️ **The ruleset half cannot adopt.** Alchemy's `Ruleset` reports nothing without prior state and
creates unconditionally, and GitHub allows two rulesets with one name — so a first deploy onto a
repository that already has one adds a second, both enforcing. `GitHub.Repository` does not share
the problem. Check `gh api repos/<owner>/<repo>/rulesets` first, or pass your own `rulesetName`.
See `docs/repo-policy.md`.
