---
'@homeflare/distilled-proxmox': patch
'@homeflare/distilled-proxmox-backup': patch
---

Encode PVE and PBS form arrays as repeated keys and expose precisely typed
missing configuration errors so Alchemy providers can adopt and delete safely.
Validate PBS responses while preserving extra fields and valid Unit responses;
malformed payload diagnostics do not retain server data.
Both SDK error unions now include every HTTP status class their protocols return,
so callers can handle typed NotFound without hiding other failures.

Regenerated from local distilled source against pve-manager 9.2.11 and
proxmox-backup-server 4.2.6-1 schemas. Read-only probes on PVE 9.2.11 and PBS
4.2.3 confirmed missing-resource wire shapes; the PBS SDK also read live version,
datastore and notification configuration successfully. No upstream write.
