# Alchemy changelog archive 4

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

**`Grafana.MuteTiming`:** a genuine SDK finding worth restating here — the generated
`MuteTimeInterval` type has no `provenance`/`version` fields, and its `TimeInterval` type is
missing the real Alertmanager time-interval fields (`weekdays`/`times`/`months`/etc.) entirely, even
though Grafana's real API sends and accepts all of them. Proven NOT to be a data-loss gap:
`@distilled.cloud/core`'s response decoding never runs a strict schema decode, only `JSON.parse`
plus a key-rename pass that leaves any key a type doesn't model verbatim — confirmed by driving the
real operation through this family's own fake-Grafana test harness. `mute-timing.ts` reads/writes
through a small locally-widened type instead of the SDK's own. Tracked in
`docs/upstream-conformance.md` as a real SDK type-generation gap (the same fix route as the other
named gaps there) — not attempted here, since `packages/distilled-grafana/src/` is vendored code
this kit never hand-edits.

**`Grafana.MessageTemplate`:** create and update are the same `PUT` wire call — measured, no
`routePostTemplate` exists — kept as two spec functions anyway so the shared engine's `diff` reports
a content change as `update`, not the `replace` it shows for any resource whose `spec.update` is
undefined.

Tests (`contact-point.test.ts` + `contact-point-secrets.test.ts` + `contact-point-provenance.test.ts`,
`mute-timing.test.ts`, `message-template.test.ts` — `ContactPoint`'s split three ways to stay under
the house's 250-line file cap) use the family's existing `fake-grafana.ts` harness and prove: a GET
never carries a body; a foreign-provenance object (explicit `"file"` or a MISSING field) refuses
update/destroy with no write sent, and an explicit `""` is writable; a transient failure (401/403)
propagates rather than folding to absent; an unchanged declaration is a noop despite an injected
field the declaration never mentioned; and, for `Grafana.ContactPoint`, that a secret value never
appears in a real `reconcile`'s returned attributes (not just in the declaration, which never held
it to begin with) — driven end to end through create, then the read-back `resource.ts` always does.
`subset-match.ts`'s array-length rule is flagged as unverified against a live mute timing and pinned
by its own test, per the same review.

### Patch Changes

- [#248](https://github.com/taslabs-net/homeflare-kit/pull/248) [`4681702`](https://github.com/taslabs-net/homeflare-kit/commit/46817022ef49186139287d8706be30cb57dbd742) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `@homeflare/alchemy/linux` now re-exports `renderContainerFile` and `containerPathFor` from
  `Podman.Container`'s pure `.container` file renderer — the same kind of pure helper `renderUnit`/
  `DEFAULT_UNIT_DIRECTORY` already are for `Systemd.Unit`. A consumer proving its own declared
  props render into the directive set it expects (an equivalence/fixture test against a live host)
  previously had no import path to the real renderer and had to reimplement the render contract by
  hand to write that test at all (found: homeflare-ct100 PR [#1](https://github.com/taslabs-net/homeflare-kit/issues/1)).

## 0.33.0

### Minor Changes

- [#245](https://github.com/taslabs-net/homeflare-kit/pull/245) [`672f60f`](https://github.com/taslabs-net/homeflare-kit/commit/672f60f8ad43b02b1dd151540a2d5f13e716e4f9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `grafana/*` ships `Grafana.Folder` and `Grafana.Dashboard`, on top of the same
  `@distilled.cloud/grafana@0.2.0` (aliased onto `@homeflare/distilled-grafana`) operations that
  fixed the family's SDK gap: `createFolder`/`getFolderByUID`/`updateFolder`/`deleteFolder` and
  `postDashboard`/`getDashboard`/`deleteDashboard`, plus the typed `PreconditionFailed` (412) for
  dashboard version conflicts. Same file shape and uid-required doctrine as the existing
  `Grafana.Datasource` (`resource.ts`'s shared `GrafanaSpec`/`grafanaOperations`/`grafanaHandlers`,
  `grafanaProviders(target)` for credentials). Full detail, including which claims were measured
  against the SDK's generated types versus inferred (no live call was made in this PR):
  `docs/grafana-folder-dashboard.md`.

  **`Grafana.Folder`:** `description` is write-only — MEASURED against the SDK's generated types,
  `Folder`'s GET response has no `description` field at all though create/update both accept one —
  so it is sent on every write that declares it but never diffed, the same treatment
  `Grafana.Datasource` gives `secureJsonDataRefs`. Nesting (`parentUid`) is create-only — MEASURED,
  `UpdateFolderRequest` has no `parentUid` field — so a declaration whose `parentUid` no longer
  matches the live folder REFUSES with `GrafanaFolderReparentError` instead of silently doing
  nothing or deleting-and-recreating under the new parent. `update` sends `version` for optimistic
  concurrency, but the SDK's own doc comment on `UpdateFolderRequest.version` says "only used by the
  legacy folder implementation" — unverified whether Grafana's newer unified-storage folder backend
  honors it at all, flagged rather than presented as a verified 412-style guard. Delete defaults to
  `defaultRemovalPolicy: 'retain'`: `deleteFolder` takes every dashboard and alert rule in the
  folder with it, the same multi-object-cascade class `openbao/mount.ts` already guards this way
  (verified there against Alchemy's own `Apply.ts`, not re-verified here — same engine, same
  option). A stack that wants the cascade opts in with `.pipe(RemovalPolicy.destroy())`.

  **`Grafana.Dashboard`:** the declared content is the dashboard JSON model, the same shape
  Grafana's "Export as JSON" produces. `dashboard-model.ts`'s `normalizeModel` strips
  `id`/`version`/`iteration` and forces `uid` to the resource's own value before any comparison, so
  a pasted export and a freshly-read live model compare equal and an unchanged dashboard plans as a
  true noop despite those fields moving on every live save. `panels` and each panel's `targets` are
  array-order-significant and compared positionally; nothing in a dashboard model needed UniFi's
  `sortedSet` treatment. **`matches` compares "declaration is a subset of live", not plain
  equality** (`declaredContentMatches`) — an adversarial review of this PR found plain structural
  equality made an ordinary, never-edited dashboard show `update` forever, because Grafana's own
  schema migration on save decorates any panel/target whose `datasource` is absent with an explicit
  reference; a declaration silent about a field is now tolerated rather than compared, while a field
  it DOES mention is still caught exactly as before (traded off: an omitted field can no longer
  force-clear one Grafana or a prior declaration set — see the doc for the full reasoning). Version
  conflicts (412) fail loudly and are never overwritten blindly: `update` injects the version this
  resource just read into the model it sends and never sets `overwrite`; a genuine conflict
  propagates `PreconditionFailed` uncaught and fails the whole reconcile, with the next
  plan/deploy's own `fetchLive` serving as the re-read. Delete does **not** default to retain — a
  single-object blast radius, the same class `Grafana.Datasource` already accepts.

  **Both refuse writes to a provisioned (file-managed) object** — `Folder.managedBy` (non-empty) and
  `DashboardMeta.provisioned`/`provisionedExternalId`, checked in `update`/`destroy` before any SDK
  call, naming the owning file when Grafana reports one. `matches` still compares structurally
  regardless, so a mismatched declaration against a provisioned object shows `update` in a plan
  rather than a silently-hidden noop, and only fails at the point reconcile would actually write;
  adopting a provisioned object read-only (a declaration matching what is live) never reaches the
  refusal. ⚠️ `Folder.managedBy`'s exact values are INFERRED from the SDK's schema, not measured —
  no live instance in this house currently has a file-provisioned folder to read (`teslamate-grafana`
  has none at all).

  Tests (`folder.test.ts`, `dashboard.test.ts`, `dashboard-model.test.ts`) use the family's existing
  `fake-grafana.ts` harness — the real distilled protocol, only wire responses faked — and prove:
  every request carries only its own declared fields (a GET's body is asserted `undefined`, the
  exact "distilled JSON-encodes unknown keys as a body" trap this family's shared memory names);
  provisioned objects refuse update/destroy with no write sent; a transient failure (401/403)
  propagates rather than folding to absent; an unchanged declaration is a noop despite volatile
  fields differing; and a 412 propagates uncaught.

### Patch Changes

- [#246](https://github.com/taslabs-net/homeflare-kit/pull/246) [`953c361`](https://github.com/taslabs-net/homeflare-kit/commit/953c3617ac5b1cbd06d1c91f6562d2b4f3db346f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `proxmox/*` family's `nodes/storage` sub-area, second resource (decision 43's serial proxmox
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
