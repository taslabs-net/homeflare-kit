---
'@homeflare/alchemy': patch
---

Move Lxc reads, writes and task polling to named distilled operations. Preserve task
credentials, ownership, digests, no-shrink checks and retention; prove absence with
the exact SDK missing-config tag and the same credential's cluster-wide vmid check.
