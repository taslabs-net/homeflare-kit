---
'@homeflare/distilled-proxmox': patch
---

Expose the vendor's exact missing-container-config response as LxcConfigNotFound on
GET, PUT and DELETE (all three raise byte-identical vendor text). Keep generic server
failures and other guest paths distinct.
