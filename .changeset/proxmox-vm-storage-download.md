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
remember the `url`/`checksum` a volume was created from, so `filename` (with `storage`) is the
identity: changing it plans a `replace` (the old file is deleted, the new one downloaded under its
own name); a changed `checksum`/`url`/etc on the SAME `filename` is refused at plan time rather than
silently accepted, since there is nothing left to verify it against. A failed download task (a
checksum mismatch included) refuses the plan rather than reporting success. Delete is idempotent
(a volume already gone is success) and not retained by default, since the file is reproducible from
its own declaration.

Both families are wired into the vendor constraint tables (`download-url`'s own
`generated/constraints/pve-nodes-storage.ts`) and the ownership ledger, so a value the vendor would
reject is refused at plan time. A live VM or file this stack holds no state for is never adopted or
written without `--adopt` / `adopt(true)` (`ownership/probe.ts`'s `ownedRead`, `ownership/adopt.ts`'s
`refuseTakeover`) — for `Proxmox.StorageDownload` this also guards its delete, since the family is
not retained by default. A changed `vmid` on an already-managed `Proxmox.Vm` is refused as a
different machine rather than planned as an update. Disk (`scsiN`/`ideN`) and NIC (`netN`) drift is
now judged per key against the live volume id and live MAC (`qemu-volume.ts`/`qemu-net.ts`), so a
declared "new disk" or MAC-less NIC no longer re-drifts (and gets rewritten) on every deploy after
PVE allocates the real volume or generates the real MAC. Fixed a codegen gap surfaced by
`download-url`'s `compression` parameter: an explicit vendor `"enum": null` (as opposed to an absent
`enum`) was copied verbatim into the emitted table instead of being treated as no constraint.
