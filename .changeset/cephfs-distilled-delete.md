---
'@homeflare/alchemy': patch
---

Complete the CephFS transport migration to distilled Proxmox 0.3.0 (vendor schema
pve-manager 9.2.11): send destructive DELETE flags through its corrected query binding
and fold only the typed CephFsNotFound error. Preserve bounded task polling, safe
omitted-flag defaults and the final live index read that proves deletion.
