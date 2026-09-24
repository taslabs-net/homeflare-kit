---
'@homeflare/alchemy': patch
---

The `proxmox/*` family's `nodes/storage` sub-area, second resource (decision 43's serial proxmox
walk-down, after `access` in PR 231/239 and `storage` in PR 243): migrates `Proxmox.ZfsPool` off
`client.ts`'s hand-rolled `pve()`/`pveOperations` onto `@distilled.cloud/proxmox`'s typed
`nodes.getNodeDiskZfs`/`createNodeDiskZfs`/`deleteNodeDiskZfs`. Split into `zfs-pool.ts`
(resource + props), `zfs-pool-wire.ts` (the read side) and `zfs-pool-form.ts` (the write side) —
the api-token.ts/api-token-form.ts seam.

**Clears this family's own cries-wolf false updates.** `Proxmox.ZfsPool` reads with the `read`
role (`Sys.Audit` on `/` — unlike `Proxmox.Storage`/`Proxmox.Acl`, it never needed `provision` for
a GET), and the pre-migration `pveOperations.read` folded any REFUSED mint into "absent" the same
way every family did before its own fix — this family just hadn't been measured failing on the
agent lane yet, since its privilege requirement is looser. Now wired the same dual-path pattern
PR 239/243 established: `readPoolOrFail` (non-folding, used by `diff`, so a genuine transient
failure propagates and fails the plan loudly) and `readPool` (folding, used by `createPool`'s
settle-poll and by `read`/`reconcile`'s create-detection) — `read`'s own provider hook branches on
`output` from the start, so `alchemy drift` never reports a transient failure as a silent
`{action: 'missing'}` either.

**A missing pool is a 500, not a 404** — MEASURED against the live cluster (TB4 `n2`, read-role,
read-only probe): `GET /nodes/n2/disks/zfs/<missing>` answers a generic shelled-out `zpool status`
command failure at HTTP 500, the same class of measured 500 every other migrated family has.

**Decision 9's adopt-only mode is preserved exactly**, including the one nuance new to this
family: distilled's generated `CreateNodeDiskZfsRequest` marks `devices` and `raidlevel` as
REQUIRED fields (no `?`), unlike PVE's own runtime behaviour, which this resource's adopt-only
declarations depend on being able to omit. `createForm` stays a loosely-typed `Record<string,
string>` that can omit both — used for the vendor-constraint check (now `guardForm`, called
directly rather than through `guardWrite`, since this is the first migrated family whose
create-guard is CONDITIONAL: `guardWrite`'s own signature requires a real `EndpointKey`, but an
adopt-only declaration needs `undefined` some of the time) — and a separate `as unknown as` cast
builds the distilled-shaped request only at the point `createPool`'s own runtime guard has already
confirmed both fields are genuinely present, exactly preserving the pre-migration behaviour.

**One field needed distilled's hyphen-to-underscore rename** (`draid-config` -> `draid_config`,
the property `T.Body("draid-config")` maps back to the wire on the way out) — `storage.ts`/
`storage-form.ts`'s own measured finding from PR 243, here for a single field rather than a
free-form locator bag.

**`createPool`'s settle-poll (30 reads, 2s apart) is unchanged in behaviour** — still polling
`readPool`, not `@distilled.cloud/proxmox`'s own `Task.awaitTask`, which exists and would remove
the "not yet vs. forbidden" ambiguity the settle-poll's own comment already names as a known
weakness. Left as a documented follow-up rather than folded into this migration silently: swapping
it changes this resource's OBSERVABLE behaviour on a slow create (what a caller sees, and how),
which is an improvement to weigh on its own, not a transport swap.

**Two findings from adversarial review, both pre-existing (unchanged in shape from before this
migration, per `git blame`) but newly documented or fixed here:**

1. A re-run of `deploy` after `createPool`'s give-up `die` can, in a narrow window, POST a SECOND
   `zpool create` at the same devices while the first worker is still writing them — the same
   "not yet vs. forbidden" ambiguity the settle-poll already has, just for a retry rather than the
   first attempt. Not fixed (a real fix needs task-status tracking, not a transport swap); the
   give-up message and `createPool`'s own header now say so explicitly, where before they only
   described the ambiguity as a slow-create observability gap.
2. `diff` (and its vendor-constraint check) never runs for a genuinely first-ever declaration —
   upstream `Plan.ts` routes a brand-new resource straight to `create` without ever calling
   `provider.diff` — so THIS WAS THE ONLY WRITE PATH IN THE FAMILY WITH NO VENDOR CHECK AT ALL,
   before or after the migration started. Fixed: `createPool` now re-runs `guardForm` immediately
   before its own POST, the same pattern `ceph-pool.ts`'s hand-written `reconcile` already uses
   for the same reason.

**Also found and fixed while responding to that review** (not a finding from the review itself,
caught by re-running the full test suite after the changes above): an edit made to drop a dead
`matches()` export accidentally deleted the entire `live === undefined` branch of `diff` alongside
it, which would have made a genuinely-vanished pool plan `noop` forever instead of `update` —
caught immediately by `zfs-pool-adopt.test.ts`'s own pre-existing "an adopted pool that vanishes"
test failing, restored before this PR opened, left here for the record rather than silently
squashed into the diff.

`zfs-pool-adopt.test.ts` (the existing coverage — adopt-only noop/adopted, retain-vs-destroy, the
`ZfsRaidLevel` compile-time refusal) passes unchanged against the migrated code — `fake-pve.ts`'s
stub is transport-agnostic — plus one new case for finding 2 above (confirmed to reach a live
`POST` on the fake cluster without the fix, before timing out at the settle-poll). `zfs-pool-read-
failure.test.ts` (new) pins the cries-wolf fix, the transient-failure propagation, and the
`alchemy drift` fix, mirroring PR 243's `storage-read-failure.test.ts` — each assertion confirmed
to fail against the pre-fix code before landing.

**Scope note, not fixed by this PR:** `Proxmox.NodeNetwork` and `Proxmox.NetworkApply` (the rest
of the "ZFS pools + node network" sub-area) are deferred to a follow-up PR — see that PR's own
description for why they don't travel with this one.

**Expected after this releases and the consumer bumps:** no live plan change is expected — no
`Proxmox.ZfsPool` row was among the false-update rows PR 239/243 already fixed (this family's
`read`-role lease could always read it), so this PR is a transport migration plus a defensive fix
for a bug class not yet measured live for this specific family.
