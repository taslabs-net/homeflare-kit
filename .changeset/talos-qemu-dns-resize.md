---
'@homeflare/alchemy': minor
---

Add cloud-init `nameserver` and `searchdomain` to Proxmox.Vm, with PVE's address-list
validation, and `diskSizesGiB` targets for grow-only disk resizing after import.
Wait for resize completion and verify capacity before returning; equal or larger
disks are left alone and decreasing a previously declared target raises a typed
`QemuDiskResizeRefused` error. No guest is started by this resource.
Interrupted creates recover without adoption when only disk growth remains; resize
waits for live VM locks within its polling budget and refuses if they persist.

Walked against the committed pve-manager 9.2.11/f6997e698c7933ea schema and existing
generated distilled QEMU resize operation; verified with fake PVE only. Address-list
semantics were checked against pve-common defd246f31f327463f901a2daaf8dc52efcc5a97.
