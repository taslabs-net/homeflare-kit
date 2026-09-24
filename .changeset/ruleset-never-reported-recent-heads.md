---
'@homeflare/alchemy': minor
---

`GitHub.RepositoryRuleset`'s "never-reported context" guard (`refuseUnreportedContexts` /
`hasContextReportedSuccess`) checked only the default branch's current tip. The house's rendered
CI (`packages/config/src/repo-shape/ci.ts`) triggers on `pull_request` only, deliberately (no
`push: [main]` — a squash-merged commit re-testing an already-green PR was ~41% of the mini's CI
load, measured 2026-09-15..22), so `ci`, `secret scan` and `CodeQL` never report on the tip
itself. The guard refused adding any of them everywhere, including homeflare-builds' pending
first ruleset.

`hasContextReportedSuccess` now falls back to up to `RECENT_MERGED_PR_LIMIT` (10) recent merged
pull requests' head SHAs — one bounded list call, never the repo's full PR history — checked only
if the tip itself has no reported success. A context that has never reported success ANYWHERE
(not the tip, not any recent merged head) is still refused: the guard's whole purpose is
unchanged, only where it is willing to look for evidence widened.

The core logic (`contextReportedSuccess`, `hasRefReportedSuccess`, `recentMergedHeadShas`) is now
exported as plain functions over a real `OctokitClient`, not only reachable through the
`GitHubCredentials`-gated `RulesetOctokit` — the same pure-function seam `desiredWireRuleset`
already uses — so `repository-ruleset-octokit.test.ts` measures it against a real `@octokit/rest`
instance with a fetch shim (no network), mirroring the H15 wire test: accepting a context that
reports only on a recent merged head, refusing one that reports nowhere, and refusing one whose
only success is older than the bound (the limit is real, not decorative).
