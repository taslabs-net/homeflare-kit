# Cloud-init DNS and imported disk growth

```ts
Proxmox.Vm('talos', {
  target,
  node: 'n2',
  vmid: 10000,
  scsi0: 'cephtb4:0,import-from=cephfs-tb4:import/talos.raw',
  diskSizesGiB: { scsi0: 64 },
  ide2: 'cephtb4:cloudinit',
  ipconfig0: 'ip=10.20.16.20/24,gw=10.20.16.254',
  nameserver: '10.20.16.254',
  searchdomain: 'example.internal',
});
```

`diskSizesGiB` declares minimum capacity in positive integer GiB. Declare the disk
slot alongside its target. Equal or larger live disks need no resize; lowering a
previously declared target is refused with `QemuDiskResizeRefused`, which callers
can handle with `Effect.catchTag`. Removing a target leaves capacity unmanaged.
Unsupported slots, CD-ROM/cloud-init drives and unreadable live sizes are refused.

The provider waits for import, reads the allocated disk, sends an absolute target
through the generated `putNodeQemuResize` operation, waits for its task, and verifies
the resulting capacity. Interrupted applies can safely retry without adding capacity
twice. `size=` in a volume config string is still observed metadata: omit it when
using a resize target. An unrelated update never resends the import source.

This resource never starts a VM. Complete its reconciliation before the separate
power-on step. Resizing an existing guest does not grow its partitions/filesystems.

DNS keys use the same declared-key comparison as `ipconfig0`: omitted keys remain
unmanaged. `nameserver` enforces the generated `address-list` constraint; PVE permits
IP addresses or DNS names, separated by whitespace, commas or semicolons. The provider
preserves the supplied spelling. `searchdomain` has no extra schema constraint.

Schema provenance: `codegen/manifest.json`, pve-manager **9.2.11/f6997e698c7933ea**,
SHA-256 `9def8f13611184ee1c7d0399713130dfc4a065701d0d91a69b9c03df929344e9`.
QEMU resize already exists in both generated surfaces: distilled's `nodes.ts` and
the legacy generator's packed `nodes-node-qemu-vmid-mtunnel.ts`. A filename search
for `qemu-vmid-resize.ts` misses the latter; neither output needs hand editing.
Both caches were recovered byte-for-byte from public vendor sources, then
`bun codegen/constraints.ts` generated the resize guard. The existing type generator
already supports the operation. No generated file was edited by hand.

Recovery used the vendor Makefile's concatenation order: `api-viewer/apidata.js`
and `api-viewer/PVEAPI.js` from proxmox/pve-docs
`4e7ff22c70eb35c63e65b0ba65c98980cb4d7bf5`, then `src/api-viewer/APIViewer.js`
from proxmox/proxmox-widget-toolkit `9204a77880eb31aff6ffc8bcf65ca48539685ab1`.
The result is exactly 4,337,847 bytes and the manifest SHA-256 above. PBS's 1,508,860
bytes were recovered from the public `proxmox-backup-docs_4.2.3-1_all.deb`, matching
the manifest's full SHA-256 (the recorded server version is 4.2.6-1, running 4.2.3).
No host was contacted. Tests cover generated constraints/types and fake SDK transport.

The named format's semantics come from
[PVE::JSONSchema](https://github.com/proxmox/pve-common/blob/defd246f31f327463f901a2daaf8dc52efcc5a97/src/PVE/JSONSchema.pm)
and `PVE::ParseUtils` at the same commit, inspected 2026-10-05. This is vendor-source
and fake-transport evidence; no live PVE call or Talos boot was performed.
