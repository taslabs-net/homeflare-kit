---
'@homeflare/alchemy': minor
---

Export `Proxmox.Vm` (`ProxmoxVm`) from the public barrel for Talos VMs: cpu/cores/sockets/memory,
scsi disks on any storage (including `cephtb4`), `net0`/indexed NICs as a VLAN-aware bridge+tag,
the cloud-init drive and `ipconfig0`, boot order, the guest agent and a serial console. Every field
is managed only when declared (`qemu-props.ts`'s declared-keys model) — the fix for the
"5-default PUT", where an update used to resend `cores`/`memory`/`name`/`onboot`/`sockets` with a
hard default for whichever field the declaration left out, silently resetting it on an adopted VM.
`cipassword` and `machine` can never be props (typed `never`, and refused at runtime if smuggled
past the types). `ProxmoxVm` defaults to `RemovalPolicy.retain()`. Node-pinned semantics are
unchanged: a VM found on another node still fails the plan ("A migration is not an update").

Add `Proxmox.StorageDownload` (`ProxmoxStorageDownload`): a checksum-pinned `download-url` fetch
onto a storage's `import` content, for staging a Talos boot image before a `Proxmox.Vm` references
it as a disk source. `checksum`/`checksumAlgorithm` are required props (narrower than the vendor's
own optional pair) and refused at runtime if left blank. There is no update path — PVE does not
remember the `url`/`checksum` a volume was created from, so a changed declaration on an existing
`filename` plans `noop`; declare a new `filename` to force a re-download. A failed download task
(a checksum mismatch included) refuses the plan rather than reporting success. Delete is idempotent
(a volume already gone is success) and not retained by default, since the file is reproducible from
its own declaration.

Both families are wired into the vendor constraint tables (`download-url`'s own
`generated/constraints/pve-nodes-storage.ts`) and the ownership ledger, so a value the vendor would
reject is refused at plan time. Fixed a codegen gap surfaced by `download-url`'s `compression`
parameter: an explicit vendor `"enum": null` (as opposed to an absent `enum`) was copied verbatim
into the emitted table instead of being treated as no constraint.
