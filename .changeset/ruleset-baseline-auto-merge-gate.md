---
'@homeflare/alchemy': patch
---

`repoBaselineSettings` (repo-baseline-data.ts) no longer turns `allowAutoMerge` on
unconditionally — it now follows `checks.length > 0`, the same as the sibling `repoPolicy` path
already refuses to do (`repo-policy-guards.ts`'s `assertAutoMergeWaits`). With zero required
status checks, `gh pr merge --auto` (and the ruleset's own auto-merge) has nothing to wait for:
GitHub merges a CLEAN pull request on the spot, with no review and no green run required. A repo
declared through `declareRepoBaseline` with an empty `checks` list (homeflare-anyauth today, for
example — no workflows, so no checks to name) would otherwise get auto-merge turned on with
nothing gating it.

This baseline has no `autoMerge` opt-out prop the way `repoPolicy` does, so the fix is
unconditional rather than a thrown refusal: a repo with checks keeps `allowAutoMerge: true`
exactly as before; one without simply never gets it turned on by this baseline.
