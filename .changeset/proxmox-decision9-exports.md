---
'@homeflare/alchemy': minor
---

Export `ProxmoxApiToken` and `ProxmoxZfsPool` from `@homeflare/alchemy/proxmox`, per Tim's
decision 9 (2026-09-23): the kit builds an ApiToken export that is metadata-only and a ZfsPool
export that is adopt-only. Neither can create what it does not already have to adopt.

`ProxmoxApiToken` adopts and manages `comment`, `expire` and `privsep` — the whole of a token's
policy that PVE will report back — and refuses to mint a new one: the secret exists for one HTTP
response and then nowhere (measured from the vendor schema), and this estate's state store
persists attributes unencrypted, so a token created here would be a live credential nobody holds.
`reconcile` dies by name when the token is absent, naming the two ways to get a usable one
(`pveum user token add`, or OpenBao's `proxmox-c1` mount) instead. `shape()` is now typed against
the generated `AccessUsersUseridTokenTokenidPutParams` and `PostParams`, so a schema drift fails
`tsc` here rather than surfacing as a 400 on a live cluster.

`ProxmoxZfsPool`'s `devices` and `raidlevel` are now optional: omitting both declares an
adopt-only pool, for one PVE's own POST schema cannot fully describe — a stripe layout has no
`raidlevel` to declare. `ZfsRaidLevel` and `ZfsCompression` are now generated aliases of
`NodesNodeDisksZfsPostParams`'s fields rather than hand-typed, so PVE adding or removing a
`raidlevel` value is caught by `tsc`, not discovered on a live cluster. `createPool` refuses
before any POST when an adopt-only declaration's pool is not already there. `zfs-pool.ts`'s
header previously said destroy was refused and `delete` made no API call — that was false
(`destroyPool` sends a real `DELETE`, guarded only by the resource's default `retain` removal
policy); the header is corrected, and `delete` is unchanged.

Walked down against the manifest-verified `pve-apidoc` cache, pve-manager 9.2.11/f6997e698c7933ea,
sha256 `9def8f13611184ee1c7d0399713130dfc4a065701d0d91a69b9c03df929344e9` — re-sliced for this
change with `codegen/apidoc.ts`'s own parser (2026-09-23), rather than assumed from the header's
2026-09-13 measurement. The four endpoint definitions this change touches (`POST`/`GET`/`DELETE`
`/nodes/{node}/disks/zfs[/{name}]`, `GET`/`POST`/`PUT`/`DELETE`
`/access/users/{userid}/token/{tokenid}`) are byte-identical against the cached 9.2.4 apidoc, so
nothing here is pinned to a version drift between them.
