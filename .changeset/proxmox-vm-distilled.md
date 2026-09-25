---
'@homeflare/distilled-proxmox': patch
'@homeflare/alchemy': patch
---

Move Proxmox.Vm onto named QEMU operations. Guest deletion uses the destroy route, and only the vendor missing-config error is absence.
