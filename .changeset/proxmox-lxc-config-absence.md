---
'@homeflare/distilled-proxmox': patch
---

Expose the vendor's exact missing-container-config GET response as LxcConfigNotFound.
Keep generic server failures, other guest paths and write errors distinct.
