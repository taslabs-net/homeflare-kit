---
'@homeflare/config': patch
---

`repo-shape` now clears a rendered file after `render.ts` stops emitting it, instead of
leaving it behind forever. MEASURED 2026-09-24: `@homeflare/config` 0.12.0 (PR 199) stopped
rendering `.github/workflows/dependabot-automerge.yml`, but `repo-shape:refresh` only ever
writes the files it renders — it never deleted the one it used to render. Every repository
that had already refreshed to 0.12.0 (homeflare-wiki bump PR 19, homeflare-mini bump PR 47)
kept the dead file, and `repo-shape check` never flagged it, because it only compared paths
the current shape renders.

`RETIRED_FILES` (`src/repo-shape/retired.ts`) is the reasoned list of paths this package
used to render, each with the version that stopped and why. `repo-shape check` now reports
a retired path that is still present, with the fix command. `repo-shape:refresh` deletes a
retired path only when it can prove it rendered it — the file still carries the
`🤖 RENDERED BY @homeflare/config` header — and refuses and reports it otherwise, the same
way it refuses to overwrite an excepted file; it never deletes a hand-written file.

Once this releases, the next `homeflare-bumper` run spreads the fix: a refresh in each
consumer deletes the fossil. That deletion touches `.github/workflows/`, so the bumper
holds those pull requests for a person rather than auto-merging them, which is its existing
behaviour for any change under that path.
