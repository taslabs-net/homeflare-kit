---
'@homeflare/config': patch
---

The rendered `ci.yml` now pins `actions/setup-node@v7` (was `@v6`) for repositories that declare `node:` in their shape. Dependabot cannot land this bump in a consumer: `ci.yml` is rendered by this package, so a hand bump fails the consumer's `repo-shape` drift test. The pin moves here, and a consumer picks it up with the config bump plus `bun run repo-shape:refresh`. `actions/setup-node` v7 exists (tag `v7` -> `949feb2413d6458794dcd2491c4babbbce0c15c1`, latest release `v7.1.0`, measured 2026-10-09 with `gh api`), and the two consumers that declare `node:` (homeflare-alerts, homeflare-blog) run on the mini's linux/arm64 runner, where v7 is the action's supported runtime: its `action.yml` at `v7` declares `runs.using: 'node24'`.
