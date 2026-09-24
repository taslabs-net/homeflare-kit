---
'@homeflare/alchemy': patch
---

Use the distilled Proxmox SDK's typed missing-user, group, storage and Ceph-pool errors
for absence. Propagate other cold-read/reconcile failures, and propagate failed Ceph
filesystem and daemon index reads instead of treating them as missing resources.

This prevents speculative creates after failed reads and prevents a CephFS delete
from claiming success when its preflight or read-back cannot observe the filesystem.
Existing confirmed-row User/Group/Storage checks and credential-denial reporting remain.
Real-protocol fixtures cover expected absence and unrelated 401/403/500 errors; engine
tests prove a failed cold read sends no create and a failed delete read is not success.
