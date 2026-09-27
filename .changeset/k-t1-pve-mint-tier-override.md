---
'@homeflare/alchemy': minor
---

`PveTarget` gains an optional `roles` field (`{ read?: string; provision?: string }`) that
overrides which OpenBao mint TIER NAME a semantic `PveRole` resolves to — `mintTier`
(`proxmox/credentials.ts`) is the one place that resolution happens, and it is now the single
composer of `<mount>/creds/<tier>` across the package: `mint.ts`'s HTTP call, its error paths
(`PveCredentialDenied` now carries the resolved `tier` in place of the semantic `role` it used to
carry, so a 403 message names the tier actually requested — the bare role is no longer
reconstructible once an override applies, so it was dropped rather than left stale), and
`lease-cache.ts`'s cache key (a resolved-tier lease key was required too — without it, two
consumers sharing a mount/role but different overrides would collide into one cache entry and
hand each other's credential to the wrong caller; see `lease-cache.ts`'s own header).

Omitted `roles`, or a role it doesn't name: unchanged — `role` is also the tier name, exactly as
every consumer before this field got. homeflare-proxmox's Talos lane is the first consumer,
scoping its reads through the `talos-provision` tier instead of the estate's general `read`
(board decision 69's talos-deploy lane).
