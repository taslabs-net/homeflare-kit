---
'@homeflare/alchemy': patch
---

Correct the last stale claim in `Proxmox.ZfsPool`'s docs, per Tim's decision 28 (2026-09-23).

PR 154 already corrected `zfs-pool.ts`'s header, which previously said destroy was refused and
`delete` made no API call — false, since `destroyPool` sends a real `DELETE` under
`.pipe(RemovalPolicy.destroy())`, guarded only by the resource's default `retain` removal policy.
That fix missed one line: the file's "PRIVILEGES, FROM THE SCHEMA" paragraph still said `delete`
"needs nothing at all, since it calls nothing" — the same mistake, left uncorrected in a second
place. It now says `delete` needs `Sys.Modify` on `/`, the same as `reconcile`'s POST, per
`ceph-osd.ts`'s own privilege comparison (measured against the same 2026-09-13 apidoc read),
which names `disks/zfs` as one of the sibling families whose write verbs — not only the create —
carry a `Sys.Modify` check.

No behaviour change. `RemovalPolicy.destroy()` reaching a single `DELETE`, and `retain` sending
none, are already pinned in `zfs-pool-adopt.test.ts` (added by PR 154); this PR touches docs only.
