---
'@homeflare/config': patch
---

The rendered gitleaks note no longer says v2 fails outright. v2 declares `runs: node20`; GitHub removed that runtime from its hosted runner images on 2026-09-16, so v2 fails on `ubuntu-latest` and still runs on the mini's self-hosted runner. Moving to v3 drops a dependency on a runtime the platform has withdrawn, before any job moves back to a hosted runner. It is not repairing a scan that is currently broken.

A repository that has adopted the shape goes red on `bun run check` until `bun run repo-shape:refresh` lands in the same pull request as the `@homeflare/config` bump.
