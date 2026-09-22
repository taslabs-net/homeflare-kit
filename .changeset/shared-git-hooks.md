---
'@homeflare/config': minor
---

Ship the estate's git hooks from one place: `@homeflare/config/hooks` plus a
`bin/hooks.ts` runner a repo's `.husky/` wrapper delegates to.

`pre-commit` formats and lints only what is staged (sub-second), names the files it
rewrote, and restages exactly those — a file with unstaged edits on top is checked and
never rewritten, because restaging it would commit work in progress. `pre-push` runs the
repo's own `bun run check`, never `verify`, which means a live adoption verifier in
`homeflare-proxmox`. Both failures print the fix and the deliberate bypass.

Adopt with `bun add -D @homeflare/config husky`, `"prepare": "husky"`, then
`bun node_modules/@homeflare/config/bin/hooks.ts install`. `problemsInHooks()` reports
drift; it is deliberately outside `checkProject` so repos that have not adopted stay
green. ⚠️ A hook is a local convenience — skippable with `--no-verify`, absent until
`bun install` — the required checks on `main` stay the gate.

★ **husky, not lefthook or a bare `core.hooksPath`** — it is already the estate's
mechanism wherever hooks work, it installs from `prepare` on a plain `bun install`, and
it keeps the hook files tracked and reviewable. A second mechanism alongside it would
mean two ways to answer "are hooks on here".

TRIGGER for folding this into `repo-shape`: the first repository commits a
`repo-shape.ts` and a `repo-shape:refresh` script (none does today — measured
2026-09-22, `repo-shape` shipped in #112 and is adopted nowhere). At that point
`HUSKY_HOOK` moves into `renderRepoShape().files`, `.husky/pre-commit` and
`.husky/pre-push` join `RENDERED_PATHS`, and `problemsInHooks` is deleted in favour of
`driftInRepoShape`. ⛔ Not before: routing hooks through `repo-shape` today would make
every repo's hook adoption wait on a rewrite of its `ci.yml` and `security.yml`.
