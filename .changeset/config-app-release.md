---
'@homeflare/config': minor
---

Export `shouldRelease` and `require-release-config` so non-npm app repos share one GitHub-Release gate instead of copying the scripts. The guard also fails a leftover `pnpm-workspace.yaml` that hides the root package (measured 2026-09-17 on homeflare-secrets).
