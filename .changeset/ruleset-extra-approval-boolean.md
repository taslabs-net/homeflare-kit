---
'@homeflare/alchemy': minor
---

`GitHub.RepositoryRuleset`'s `rules.pullRequest.extraApprovalForUnattributedChanges` now accepts
`true`, not only `false`. Re-read live 2026-09-23, 8 rulesets carry
`require_extra_approval_for_unattributed_changes: true` (aop, cloudflareforms,
doesthishelp-workeropen, homeflare-anyauth, homeflare-desktop, loggarr, magictransit,
proxmox-tb4), so this resource could not declare their exact shape before: it would either omit
the field (leaving it unmanaged, refused once a caller also carries a `bypassActors`/rule
declaration for the same ruleset) or send `false`, which is real drift against a live `true` on
every plan.

The wire builder now sends whatever is declared instead of hardcoding `false`; `undefined` still
means "no opinion" (GitHub defaults an absent key to `true`). `repoBaselineRuleset()` in
repo-baseline-data.ts is unchanged — the house baseline still pins `false` for the repos that
fit it; a caller with a live `true` declares `RepositoryRuleset` directly with the live value,
the same pattern kit PR 205 established for `bypassActors` and rule presence.

Tested against aop's full live shape (`gh api repos/taslabs-net/aop/rulesets/14572279`,
re-read 2026-09-23): declaring the live value (including `true`) is now a genuine zero-write
adopt, and declaring `false` against a live `true` is still real drift, never a silent noop.
