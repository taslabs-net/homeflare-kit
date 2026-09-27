# Alchemy changelog archive 6

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

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

## 0.31.2

### Patch Changes

- [#239](https://github.com/taslabs-net/homeflare-kit/pull/239) [`1e8985f`](https://github.com/taslabs-net/homeflare-kit/commit/1e8985fc8359304b2c6d03df0fba00781e5e32a0) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fixes a live regression from kit 0.31.1 (PR 231, the `proxmox/access`
  distilled migration): on the agent (`read`-role) lane, `bun run plan` showed
  every `Proxmox.User`/`Proxmox.Group` row as `update` with no warning — a
  silent false diff, not the loud "read was refused" case that migration was
  meant to fix.

  **Root cause, measured against the live cluster.** `user.ts`/`group.ts`
  called `access.getAccessUser(props)`/`access.getAccessGroup(props)` with the
  whole declared props object, not just the schema's own `{userid}`/
  `{groupid}` label field. distilled's `buildRequest` treats any OTHER key on
  that object (`target`, `comment`, every other prop this family carries) as
  an "unknown key" and JSON-encodes it onto the request as a body — on what
  must stay a bodyless GET. A permissive client tolerates this; Node/Bun's own
  `fetch` refuses it outright
  (`TypeError [ERR_INVALID_ARG_VALUE]: fetch() request with GET/HEAD method
cannot have body`), which `runPveWith` retried across every cluster member
  and exhausted identically (`PveClusterExhausted`). The old
  `Effect.orElseSucceed(() => undefined)` then folded that failure into
  "absent", forcing a false `update` on every account and every group — the
  same cries-wolf bug PR 231 had just fixed for a refused credential, now
  triggered by a genuine transport failure instead. Fixed by calling both
  operations with only their declared label field.

  **The fold itself was too broad, independent of the request-shape bug.**
  `orElseSucceed` turning ANY read failure into "absent" is unsound at `diff`
  time: only a genuine not-found may mean absent, every other failure must
  fail the plan loudly rather than silently forcing a write. `acl.ts` (already
  migrated pre-231) and `role.ts` never needed a fold at all — an ACL/role's
  absence is always a successful list read that just doesn't contain the row,
  so any thrown failure was already a bug; the fold there is now removed
  outright. `api-token.ts`'s absence signal is likewise a measured
  success-path check (`expire`/`privsep` both undefined on a 200), so its
  fold is also removed outright.

  `user.ts`/`group.ts` are different: a genuinely missing user or group is a
  thrown 500 on this cluster (`"no such user"`/`"no such group"`, not a clean
  404), MEASURED live — so `reconcile`'s create workflow still needs "absent"
  derived from exactly that failure, or a brand-new declaration could never be
  created. Each now has a dual-path read in its `*-wire.ts` sibling: a
  non-folding `read...OrFail` (used by `diff`, so a genuine transient failure
  propagates and fails the plan loudly) and a folding wrapper kept only for
  `read`/`reconcile` (where folding costs at most a redundant, loudly-refused
  create, never a silent wrong write).

  **A second, deeper instance of the same bug class, found by adversarial
  review of this fix rather than measured live.** The engine calls a
  provider's `read` hook from four places — an adoption probe and
  interrupted-create recovery in `Plan.ts`, delete recovery in `Apply.ts`, and
  `Drift.ts` (`alchemy drift`/`sync`/`deploy --detect-drift`) — and only the
  first three are "nothing confirmed exists yet" cases where `read`'s own
  fold is safe. `Drift.ts` calls `read` on an ALREADY-CONFIRMED row (its own
  persisted `output`), the same situation `diff` handles, and a folded
  failure there is reported as `{action: 'missing'}` with no error anywhere —
  worse than the original bug, since nothing even logs a warning. Fixed by
  having `user.ts`/`group.ts`'s `read` hook branch on the input's own
  `output` field (documented on `Provider.read`'s own type as "current state
  -> synced state"): `output === undefined` still uses the folding read
  (unchanged, for the three recovery/adoption cases), `output !== undefined`
  now uses the same non-folding `read...OrFail` `diff` already calls.

  `read-failure-propagation.test.ts` pins all three fixes end to end against
  real-shaped PVE fixtures (live response bodies, nothing secret): a GET that
  would carry a body now fails the assertion outright; a transient 500 on an
  already-adopted `Proxmox.User`/`Proxmox.Group` now rejects `verify()`
  instead of resolving with a false `update`; and (a new `drift` capability
  on the shared `fake-engine.ts` test harness, driving the real
  `Alchemy.Drift.detect`) the same transient failure now rejects `alchemy
drift` instead of silently reporting the resource missing — each of the
  three new/changed tests was confirmed to fail against the pre-fix code
  before this change landed.

  **Expected after this releases and the consumer bumps:** on the agent
  lane, `bun run plan`'s users/groups return to `noop`, ACLs stay
  `noop`-with-warning, and the five pre-existing storage rows (a separate,
  not-yet-migrated family) are unaffected.

- [#234](https://github.com/taslabs-net/homeflare-kit/pull/234) [`3357caa`](https://github.com/taslabs-net/homeflare-kit/commit/3357caa7c9a412365d3959bbb306628329eba4f8) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `@distilled.cloud/grafana` is not published upstream yet, so this package
  now aliases it onto `@homeflare/distilled-grafana` (0.1.0 pre-release,
  built the distilled way and shipped from this monorepo — see
  `docs/distilled-interim.md`) as a plain `dependencies` entry instead of a
  `1.0.0-rc.12` peer — nothing changes for a consumer's install (the peer
  line is simply gone from the README and the smoke install, the same way
  `/netbox` and `/litellm` already read). `Grafana.Datasource`'s props,
  attributes and generated calls are unchanged — its existing tests pass
  unmodified.

  The alias also picks up `@distilled.cloud/grafana`'s newly-added folder,
  dashboard and alerting-provisioning operations (see the
  `@homeflare/distilled-grafana` changeset), which fixes the SDK-level gap
  `docs/grafana.md` and `docs/upstream-conformance.md` recorded. No new house
  `Resource` is added here — `Grafana.Folder`/`Dashboard`/`AlertRule`/etc. on
  top of these operations is follow-up work, not part of this change.

  ⚠️ **Deliberate deviation from `docs/distilled-interim.md`'s step 5.** That
  doc has the interim package publish and get confirmed live
  (`npm view @homeflare/distilled-grafana version`) in its own PR _before_ a
  second PR adds the alias — exactly to dodge the propagation window
  `scripts/publish.ts`'s own comments document twice (2026-09-15,
  `kit@0.1.1`/`cloudflare@0.1.1`: "Your package is being processed and may
  take a few minutes to become available"). This PR does both at once, on
  purpose, so the next teams building `Grafana.Folder`/`Dashboard`/`AlertRule`
  aren't blocked on a second release cycle. `scripts/publish.ts` has no
  dependency-aware ordering, so **after this releases, confirm
  `npm view @homeflare/distilled-grafana version` resolves before anyone
  depends on the new `@homeflare/alchemy` version** — a few minutes' wait,
  not a code change, and self-healing either way (the publish script is
  idempotent and a stuck install just needs a retry).

## 0.31.1

### Patch Changes
