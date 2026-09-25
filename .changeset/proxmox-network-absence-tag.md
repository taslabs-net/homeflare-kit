---
'@homeflare/distilled-proxmox': patch
---

Expose the vendor's exact missing-network-interface response as NetworkInterfaceNotFound
on GET and PUT (both raise byte-identical vendor text). Keep unrelated or multi-field
parameter validation failures distinct.
