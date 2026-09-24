---
'@homeflare/alchemy': patch
---

The `proxmox/*` family's `access` sub-area (decision 43's serial proxmox
walk-down, PR 2 after `Proxmox.Acl` in PR 209/220) now calls
`@distilled.cloud/proxmox`'s typed `access.*` operations instead of
`client.ts`'s hand-rolled, generic `pve()` call: `Proxmox.User`, `Proxmox.Group`,
`Proxmox.Role` and `Proxmox.ApiToken`. Each gets its own hand-written
reconcile (read/diff/reconcile/delete), the way `acl.ts` established, rather
than the shared `pveHandlers`/`pveOperations` factory — a `*-wire.ts` sibling
per family holds the pure wire-shape functions (create/update forms,
attributes, `matches`), keeping every file under the house's 250-line cap.
`client.ts`/`pveOperations` are untouched and still serve every other PVE
family; nothing in `nodes`, `storage`, `notifications` or PBS has moved yet.

`Proxmox.Role` reads via `GET /access/roles` (the list), not the item
`GET /access/roles/{roleid}` this family used before: distilled's generated
schema for the item response enumerates a FIXED set of ~47 known privilege
field names, and a privilege outside that set would silently vanish from
state on every read. The list's `privs` field is the same plain comma string
PVE's item read also disagreed with the index about pre-migration, with no
fixed enumeration to fall behind — `role-wire.ts`'s `find` does the item
read's old client-side job. Every other family in this PR still reads the
item it read before.

A `distilled-guard.ts` module (`asForm`/`guardWrite`) is the generalized
form of `acl.ts`'s own local `guardWrite`, needed because distilled's
generated request interfaces have no index signature and TypeScript refuses
`Record<string, string | undefined>` for them directly — `body: object`
plus one internal cast is the fix, applied once here rather than at every
call site.

**The cries-wolf fix** (measured 2026-09-24: `bun run plan` on the agent lane
showed "19 to update" — 14 ACLs and 5 storages — because a REFUSED read
folded into "absent" and `diff` forced `update` without comparing a field).
`credentials.ts`'s `mint` now fails a 403 from OpenBao (a denied
role — "this identity's AppRole has no grant") with a new typed
`PveCredentialDenied` (`credential-errors.ts`), split out from the newly
`mint.ts`-housed `mint`/`authorization` to keep `credentials.ts` under the
line cap. A new `unreadable-read.ts` module's `readOrUnreadable` `catchTag`s
exactly that one tag — never any other read failure — turning it into an
`UNREADABLE` sentinel `diff` can tell apart from a genuine absence. Upstream's
`Diff` type is exactly `NoopDiff | UpdateDiff | ReplaceDiff`
(`packages/alchemy/src/Diff.ts@v2.0.0-beta.79`) with no fourth action, and
`Plan.ts`'s resource pass fails the WHOLE plan if even one resource's `diff`
throws — so `diff` now reports `{action: 'noop'}` plus a logged warning for
an unreadable row, never a failed plan and never a forced write. Wired into
`acl.ts` (the already-migrated family) and every family in this PR;
`unreadable-read.test.ts` proves it end to end through Alchemy's real Plan
and Apply, with a fake OpenBao that denies `provision` mid-test. `storage.ts`
and the other five false updates stay open until `nodes`/`storage` migrates.

Distilled's `{userid}`/`{tokenid}` label substitution percent-encodes them
(`iac@pve` -> `iac%40pve`), where `client.ts`'s plain string concatenation
sent the `@` literally — a real PVE decodes both the same way, so this is
not a behaviour change a stack observes, but every fake cluster with an `@`
in a userid (`user.test.ts`, `api-token-adopt.test.ts`,
`provision-declare.test.ts`) now decodes the path before matching it.

State did not move: every Props/Attributes interface is unchanged, and the
existing cross-family `adopt-noop.test.ts` cases (now extended with `Group`
and `User` rows for the new hand-written reconciles) and
`api-token-adopt.test.ts` pass with the same assertions the pre-migration
code made. New tests (`group.test.ts`, `user.test.ts`, `role.test.ts`)
drive a fake PVE server through the real distilled protocol, covering
create, drift-correction, delete, retain-by-default and the read-back guard.

`codegen/constraints.ts` regenerated: `Proxmox.ApiToken` no longer names its
(always-unreachable) create endpoint anywhere in source, so the generated
tables and the hand-written ownership ledger
(`scripts/proxmox-ownership-pve.ts`) both drop that one claim — 74 tabled
endpoints, not 75.
