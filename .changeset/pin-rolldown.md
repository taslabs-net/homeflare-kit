---
'@homeflare/alchemy': patch
---

Pin `rolldown` in the consumer overrides so an unlocked install cannot float a missing tarball.

Alchemy's optional peer `vite@^8` depends on `rolldown: ~1.2.6`. A consumer `bun add`
(no lockfile) resolved that to 1.2.9; npm listed the version and 404'd
`rolldown-1.2.9.tgz`. Main CI failed on that fetch after #39. The override holds 1.2.8 —
the last tarball a green smoke actually installed.
