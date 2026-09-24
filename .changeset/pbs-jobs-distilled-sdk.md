---
'@homeflare/alchemy': patch
---

Run PBS datastore, prune, sync and verification providers through the distilled PBS SDK,
using the proxmox-backup-server 4.2.6-1 schema. Preserve existing retention, parked-job,
create-only and state semantics while allowing only typed missing-section errors to mean
absence. Permission, transport and malformed-response failures now stop planning instead
of suggesting a create or confirming a deletion.
