---
'@homeflare/alchemy': patch
---

Fixed `Proxmox.Vm`'s disk-drift check (`qemu-volume.ts`'s `judgeDisk`): it never recognized
`<storage>:0,import-from=<volid>` (PVE's create-time spelling for importing a disk from another
volume or a downloaded image) as a new-disk spelling, so it compared the declared literal volname
`"0"` against PVE's live read-back of the real `vm-<vmid>-disk-<n>` it allocated on import and
refused the update -- on the very deploy that created the disk (post-write verification reads the
config right back) and on every plan after, since the declared value stays `import-from=...` for
as long as the caller keeps declaring it that way.

Found by homeflare-proxmox PR 84's red team against a real fake-PVE engine; tracked there as the
`kit-disk-import-bug` blocker on `declareTalos`. `<storage>:0,import-from=<volid>` is now treated
the same as the existing `<storage>:GiB` and `<storage>:cloudinit` new-disk spellings: it always
matches whatever volume is already live in that slot, and no resize or option-drift PUT is ever
attempted for it.
