---
'@homeflare/alchemy': minor
---

`GitHub.RepositoryRuleset` now expresses a live ruleset's exact shape when that shape is
narrower than the house baseline: a `rules.pullRequest: false` declares its deliberate absence
(matching the `requiredStatusChecks: false` pattern that already existed), and `bypassActors`
already carried an arbitrary `actor_id`/`actor_type`/`bypass_mode` list — the gap was never the
prop shape, it was that nothing stopped a declaration from silently narrowing what is live.

Two new guards close that: `bypassNarrowingRefusal` refuses a declared `bypassActors` that drops
a live actor, and `ruleNarrowingRefusal` refuses a declared `false` (any modeled rule) that drops
a rule the live ruleset still has — both unless the declaration also carries a new prop,
`acknowledgeNarrowing: { reason: string }`, a reasoned, explicit sign-off. Widening bypass stays
refused unconditionally, as before — this only ever loosens the NARROWING side, and only with a
recorded reason.

Prompted by a red-team finding against a design for declaring ~88 `taslabs-net` repos' GitHub
settings in Alchemy: 5 live repos (`taslabs-net`, `aop`, `magictransit`, `loggarr`,
`doesthishelp-workeropen`) carry a non-empty live `bypass_actors`, and `taslabs-net` itself has
no live `pull_request` rule — the exact combination `repoBaselineRuleset()`'s hardcoded
`bypassActors: []` and always-on `pullRequest` rule could not adopt without silently stripping
protection. `repoBaselineRuleset()` itself is unchanged — it keeps its baseline defaults, for
repos the baseline shape actually fits; a caller with a narrower live ruleset now declares
`RepositoryRuleset` directly with the live shape instead.

Tested against all 5 live shapes, re-read via `gh api repos/taslabs-net/<repo>/rulesets/<id>`
2026-09-23 (not copied from an earlier paraphrase — `doesthishelp-workeropen`'s two bypass
actors' `bypass_mode`s differ from how an earlier design doc described them).
