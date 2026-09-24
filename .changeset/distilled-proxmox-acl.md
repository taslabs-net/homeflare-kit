---
'@homeflare/alchemy': patch
---

The `proxmox/*` family's `Proxmox.Acl` (the first resource in the PVE
`access/ACL` sub-area, per decision 43's serial proxmox walk-down) now calls
`@distilled.cloud/proxmox`'s typed `access.listAccessAcl`/`access.putAccessAcl`
operations instead of `client.ts`'s hand-rolled, generic `pve()` call. A new
`distilled-pve.ts` module (`runPve`/`runPveWith`) replaces `pve()`/`pveWith`
for a migrated family: the same OpenBao lease reuse (`lease-cache.ts`,
unchanged) and the same cluster-member failover safety rule (`members.ts`,
unchanged — a write may repeat only on a provably pre-send transport
failure, never on an HTTP answer or a post-connect timeout), now re-running
the whole typed operation per member instead of retrying one already-built
request. `client.ts`/`pveOperations` are untouched and still serve every
other PVE family; `Proxmox.Acl` is the first to move off them, chosen
because it was already the one family that didn't fit the generic
path+form shape (no create/delete verb — PVE has only GET/PUT on
`/access/acl`).

One dead branch is removed, not preserved: the old code's generic factory
POSTed on a "live read undefined" case that its own comments called
unreachable on a healthy cluster and documented as actively misleading (PVE
has no POST here, so the 501 it got back said nothing about the real
failure). `@distilled.cloud/proxmox` has no `createAccessAcl` at all — the
vendor schema has no POST for the generator to make one from — so there is
nothing to call that way any more. `reconcile` now always PUTs, the only
write PVE actually implements for this path, so a read that genuinely fails
surfaces its real cause instead of a confusing 501.

A trap found while writing the member-failover test: `@distilled.cloud/core`'s
default retry policy retries transport failures automatically (not just
5xx answers), which could have resent a write to the same member several
times before this file's own cluster failover ever saw a result to
classify — the hand-rolled client never auto-retried anything. `distilled-pve.ts`
disables the SDK's retry (`Retry.none`) on every attempt, keeping
member failover the only place a request repeats, matching the original
behavior exactly.

State did not move: `AclProps`/`AclAttributes` are unchanged, and the
existing cross-family `adopt-noop.test.ts` case for `Proxmox.Acl` (an
already-matching grant is read-only) passes unmodified against the new
code. New tests (`acl.test.ts`, `distilled-pve.test.ts`) drive a fake PVE
server through the real distilled protocol — real path assembly, real
form-urlencoded PUT bodies, real `{"data": ...}` envelope — covering
create, drift-correction, delete, identity-replace, the read-back guard,
and cluster-member failover for both a read and a write.

This is PR 1 of a serial, sub-area-by-sub-area migration
(access/ACL, then nodes/storage, then notifications, then PBS, …) of the
~98-resource PVE family plus the PBS resources onto
`@distilled.cloud/proxmox`/`@distilled.cloud/proxmox-backup`. The other PVE
and PBS resources still call `client.ts`'s `pve()`, unchanged; `client.ts`
is deleted only once nothing imports it.
