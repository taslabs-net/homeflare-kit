---
'@homeflare/alchemy': patch
---

`Proxmox.CephFlag` now calls the typed cluster flag operations. A GET that is not a bare boolean fails the plan instead of reading the flag as clear, and a refused read reports noop instead of aborting every other row.
