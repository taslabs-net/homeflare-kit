---
'@homeflare/alchemy': patch
---

`repoPolicy` refuses two more ways to build a ruleset that matches no ref: a blank ref
pattern (`include: ['   ']` has length 1, so the empty-array guard passed it) and an
`exclude` that cancels every `include` (exclusions win in a GitHub ruleset, so it reads
as a narrowing and acts as an off switch). Both produced an `active` ruleset over nothing
with `allowAutoMerge: true` — the end state the auto-merge guard exists to prevent.
Include and exclude patterns are now trimmed, de-duplicated and sorted like `checks`.

`docs/repo-policy.md` also records, measured against live GitHub rather than inferred,
that the ruleset half never plans a no-op, and that its `rules` and `bypass_actors` are
replaced wholesale rather than merged.
