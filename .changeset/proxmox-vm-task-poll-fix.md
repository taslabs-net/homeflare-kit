---
'@homeflare/alchemy': patch
---

Fix a regression in the QEMU distilled transport migration: qemuTask's poll loop no
longer aborts a still-running VM create/destroy on a status word other than exactly
"running"/"stopped" (the same class of fix already shipped for lxcTask).
