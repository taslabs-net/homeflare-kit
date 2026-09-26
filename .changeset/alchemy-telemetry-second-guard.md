---
'@homeflare/config': minor
---

The rendered `ci.yml` now sets `DO_NOT_TRACK: '1'` at workflow env level, applying to every job
and step.

Tim, 2026-09-26: "Opt out estate-wide" of Alchemy's OTLP telemetry (`alchemy/src/Telemetry/
Layer.ts`, ships to `otel.alchemy.run` on every plan/deploy unless opted out). The primary
opt-out is a persisted `~/.alchemy/telemetry-disabled` file on every machine that runs the CLI
interactively; a CI runner never has that file — a self-hosted job starts a fresh container per
run and a GitHub-hosted one is a fresh VM every time. This is the second guard for CI: measured
2026-09-26, no repository's `check` invokes the Alchemy CLI today (grepped every rendered
ci/security/release workflow for `alchemy`/`bin/cli.js`, zero hits beyond an unrelated comment
and a Node-import test), so this closes the gap in advance of whichever job calls it first,
rather than reacting after telemetry ships.

Every consumer of this renderer picks this up on its next `bun run repo-shape:refresh` after
bumping `@homeflare/config` — never hand-edit the rendered `ci.yml`.
