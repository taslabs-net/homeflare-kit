---
'@homeflare/alchemy': patch
---

The `proxmox/*` family's `nodes/storage` sub-area (decision 43's serial proxmox walk-down, PR 3
after `access` in PR 231/239) migrates `Proxmox.Storage` off `client.ts`'s hand-rolled `pve()`
(`resource.ts`'s `pveHandlers`) onto `@distilled.cloud/proxmox`'s typed `storage.getStorage`/
`createStorage`/`putStorage`/`deleteStorage` — the first resource of this sub-area; the rest of
`nodes`/`storage` (ZFS pools, Ceph, node network) follows in later PRs, split out because each is
independently substantial (see this PR's own description for why). `storage-wire.ts` (the read
side) and `storage-form.ts` (the write side) hold the pure wire-shape functions, the
api-token.ts/api-token-form.ts seam.

**Clears this family's own cries-wolf false updates**, MEASURED live 2026-09-24: on the agent
(`read`-role) lane, `bun run plan` showed all 5 storages (`cephfs-tb4`, `cephtb4`, `local`,
`local-zfs`, `pbs`) as `update` with no warning, because this family reads with `provision`
(`Datastore.Allocate` on `/storage` — `Datastore.Audit` is not enough) and the pre-migration
`pveOperations.read` folded a REFUSED `provision` mint into "absent" exactly like every family
before PR 231/239's fix — `unreadable-read.ts`'s own header already named this family as one of
the two the fix was written for. Now wired the same way: a refused mint reports `noop` with a
logged warning.

**A missing storage is a 500, not a 404** — MEASURED against the live cluster (TB4, admin lane,
read-only `GET /storage/hf-measure-nonexistent-probe`): `{"message":"storage '...' does not
exist\n"}` at HTTP 500, the same shape user.ts/group.ts measured for a missing user/group. So
`storage-wire.ts` carries the same dual-path read PR 239 established for those two families:
`readStorageOrFail` (non-folding, used by `diff`, so a genuine transient failure propagates and
fails the plan loudly) and `readStorage` (folding, used by `read`/`reconcile`'s create-detection).
`read`'s own provider hook also branches on `output` from the start (PR 239's own follow-up
finding, applied here proactively): `output === undefined` (Plan.ts's adoption probe, Apply.ts's
delete recovery — nothing confirmed exists yet) keeps the fold; `output !== undefined`
(`Drift.ts`'s already-confirmed row) uses the non-folding read instead, so `alchemy drift` never
reports a transient failure as a silent `{action: 'missing'}` either.

**Two measured gaps in `@distilled.cloud/proxmox`'s generated schema, handled rather than
papered over:**

- No `maxfiles` field at all (grepped across the whole package). Silently dropping a declared
  value would be the exact class of bug this migration exists to close, so `StorageProps.maxfiles`
  is now `never` — a compile error, the same treatment `StorageLocator`'s `password`/`keyring`/
  `encryption-key` already get — rather than a silent no-op. None of this cluster's 5 live
  storages set it; a consumer that genuinely needs it should file the gap upstream in the SDK's
  generator, not work around it here.
- Every hyphenated PVE field name becomes an underscore in distilled's generated TypeScript
  (`prune-backups` -> `prune_backups`, `fs-name` -> `fs_name`, and so on for every plugin field
  `StorageLocator`'s free-form bag can carry — `cephfs-tb4`'s own live locator uses `fs-name`).
  No other migrated family has a hyphenated field, so this is new here. `storage-form.ts`'s
  `underscored` translates a form built with PVE's own names into distilled's shape before the
  actual SDK call, never before the form the generated vendor-constraint tables check
  (`guardWrite`, keyed by PVE's own hyphenated names), which would otherwise silently stop
  inspecting the very fields it exists to catch. MEASURED both ways (a `storage-read-failure.test.ts`
  case run once with the translation and once without it): the wire itself carries PVE's own
  hyphenated name either way — distilled's own "unknown key" passthrough happens to re-encode an
  untranslated key correctly for a body-bearing POST/PUT (unlike the GET case that caused PR 239's
  regression, where no body should exist at all). The translation is still the right call: it
  routes every field through distilled's own declared, typed property rather than its passthrough
  fallback, so whatever per-field wire logic a future plugin field carries beyond a plain rename
  runs correctly rather than silently not running.

`storage-read-failure.test.ts` pins all of this against real-shaped fixtures (live TB4 response
bodies, measured 2026-09-24, nothing secret): the cries-wolf fix, `diff`/`verify()` rejecting on a
transient failure instead of a false `update`, `alchemy drift` rejecting instead of a silent
`missing`, and — added after an adversarial review found every test above only ever adopted an
EXISTING storage, never exercising `reconcile`'s actual create path — a brand-new storage's create
translating a hyphenated locator field for the real SDK call, and a vendor-constraint violation on
a hyphenated locator field refused before any write. Each assertion confirmed to fail against the
pre-fix code (or, for the translation claim, against the untranslated code) before landing.
`verify/fake-engine.ts` gained a `drift` capability (driving the real `Alchemy.Drift.detect`) in
PR 239, reused here; that PR's `read-failure-propagation.test.ts` already established the
transient-failure/drift test pattern for User/Group.

**Expected after this releases and the consumer bumps:** on the agent lane, `bun run plan`'s
5 storage rows return to `noop`; ACLs and users/groups (PR 231/239) stay unaffected.
