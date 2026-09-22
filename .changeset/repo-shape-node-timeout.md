---
'@homeflare/config': minor
---

repo-shape: `node:` and a job `timeout:`, so the two repositories with a real Node
requirement can take the standard instead of excepting out of it.

Measured 2026-09-22: the mini's CI job image carries no `node` on `PATH` (ubuntu-latest
always did). Two repositories had hand-written the identical `actions/setup-node@v6`
block for two real reasons — homeflare-alerts' `tests/alchemy-import.test.ts` spawns
`node` to prove the modules load the way the Alchemy CLI loads them, and homeflare-blog's
Payload requires Node >= 24.15. Rendering without it would have forced both to
`except({ file: '.github/workflows/ci.yml', … })`, handing the estate's two most
complicated CI files straight back to hand-editing.

`node: 24` renders `actions/setup-node@v6` with `package-manager-cache: false` ahead of
`setup-bun`, in `check` and in every extra job that takes the bun prologue, and never in
`workflow lint`, which installs nothing. `extraJob({ …, timeout: 15 })` renders
`timeout-minutes:` for a job that starts something with its own wait — a browser that
never paints holds a self-hosted slot for GitHub's 360-minute default rather than
reporting red, and on a 3-slot pool that is the whole pool.

Both are inputs, not exceptions: a repository that declares one keeps its drift check.
