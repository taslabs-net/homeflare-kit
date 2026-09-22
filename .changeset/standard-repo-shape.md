---
'@homeflare/config': minor
---

`@homeflare/config/repo-shape`: the standard HomeFlare repository as one declaration.

A repository declares `{ owner, repository, runner, publishes }` once and gets three
things from it: its tooling **files** (`ci.yml`, `security.yml`, `actionlint.yaml`,
`dependabot.yml`, `.changeset/config.json`), a **drift check** that fails when a committed
file is not the rendered one, and its GitHub **settings** — `renderRepoShape(shape).policy`
is the options object `@homeflare/alchemy`'s `declareRepoPolicy` takes, with the required
check contexts derived from the workflows that report them.

Measured across 13 estate repositories on 2026-09-22, the files this replaces had drifted
in ways nobody chose: 5 security workflows still carried a `push: branches: [main]` the
other 8 had dropped, 5 had no `concurrency:` block, 2 were missing `pull-requests: read`
(without which every pull-request secret scan fails 403), the gitleaks action was pinned
at `@v2` in 5 and `@v3` in 8, and 12 of 14 repositories had no Dependabot config at all.

A deviation is declared or it fails. `except({ file, reason, since })` and
`extraJob({ id, name, reason, steps })` refuse an empty reason _and_ a reason read from a
variable — both collapse to `never`, so an exception without a written reason does not
typecheck. See `packages/config/docs/repo-shape.md`.
