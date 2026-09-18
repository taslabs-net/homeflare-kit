---
'@homeflare/config': patch
---

`tagExists` now ignores husky's `GIT_DIR`, so a pre-push verify cannot read this checkout's tags (or commit into it) from the throwaway release-gate repo.
