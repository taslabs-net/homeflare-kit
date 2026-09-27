# Alchemy changelog archive 3

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

**The unit is the group, not the rule** — measured: `PUT /v1/provisioning/folder/{FolderUID}/
rule-groups/{Group}` takes the evaluation `interval` AND the full ordered `rules[]` together,
replacing the whole group in one call; the individual per-rule operations have no `interval` field
at all and cannot reorder rules within a group. Declaring rules one at a time would leave a group's
interval and rule order either undeclarable or racy across independent resources with no shared
source of truth. Mirrors Terraform's own `grafana_rule_group` resource.

Rule order is significant and never reordered — `subset-match.ts`'s existing position-significant
array comparison, proven by a dedicated test that declares the same two rules reversed and asserts
a mismatch. `uid` is required on every declared rule (this family's doctrine everywhere else).
Volatile fields (`id`, `updated`, `provenance`) are stripped before comparison by a new
`normalizeRule` (`alert-rule-group-model.ts`, mirroring `dashboard-model.ts`'s `normalizeModel`),
each measured against the read vs. write SDK shapes; `folderUID`/`ruleGroup` are forced to the
group's own canonical values and `orgID` defaults to `1` (not measured against a multi-org
instance — none exists in this house yet).

**Foreign-provenance refusal is per rule, whole-group refuse.** The `AlertRuleGroup` type itself
carries no top-level `provenance` field (measured) — each rule inside `rules[]` has its own, and
Grafana's docs say a new rule's provenance must match its group's, so this resource checks every
live rule via the shared `alerting-provenance.ts` (including the missing-means-foreign fix an
adversarial review of kit PR 250 established) and refuses the whole group's write if any rule is
foreign, naming the first one found. An empty live group has nothing to refuse on.

**A declared group whose folder does not exist refuses — it is never auto-created.** This resource
makes no folder-existence check of its own and never invokes `Grafana.Folder`'s create path.
Measured: `RoutePutAlertRuleGroupError` is `BadRequest | Forbidden | GrafanaOpError` with no
`NotFound` case, so a nonexistent `folderUid` fails the PUT as a typed, uncaught `BadRequest`
rather than being folded to absent or silently scaffolded — declare a `Grafana.Folder` first.

Delete defaults to `retain` (`defaultRemovalPolicy`) — deleting a group deletes every rule in it in
one call, the same multi-object-cascade class `Grafana.Folder` already guards this way.

⛔ **Fixed after an adversarial review of this PR: a whole-group write silently dropped any live
rule not in the declaration.** A human adding a rule in the Grafana UI minutes before a deploy
(ordinary, writable provenance — nothing for the foreign-provenance refusal to catch) would have
had it removed with no error, and `diff` only ever said `"update"` with no hint why —
`alchemy/Diff`'s `Diff` type has no fourth action to carry a lossy update through as. Fixed with a
loud, non-blocking warning (`alert-rule-group-drop-warning.ts`'s `warnOnDroppedRules`, mirroring
`proxmox/unreadable-read.ts`'s established pattern): every dropped rule is named by title and uid
in an `Effect.logWarning`, logged from both a local reimplementation of `diff` (so `bun run plan`
shows it before anything is written) and from `update` itself. This does NOT refuse the write —
the group is still the unit, by design — only makes the loss visible.

Tests (`alert-rule-group.test.ts` + `alert-rule-group-model.test.ts` +
`alert-rule-group-provenance.test.ts`, split three ways to stay under the house's 250-line file cap,
sharing fixtures from `alert-rule-group-fixtures.ts`) use the family's existing `fake-grafana.ts`
harness and prove: a GET never carries a body; a nonexistent folder propagates `BadRequest`; a
foreign-provenance rule (explicit or missing) refuses the whole group while an explicit `""` is
writable; reordering the same rules shows `update`; and an unchanged declaration is a noop despite
every rule's `id`/`updated`/`provenance` differing.

### Patch Changes

- [#251](https://github.com/taslabs-net/homeflare-kit/pull/251) [`4ef7909`](https://github.com/taslabs-net/homeflare-kit/commit/4ef790926bdcf5033aae1e31585e9490803aadf7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `proxmox/*` family's `nodes/storage` sub-area, third resource (decision 43's serial proxmox
  walk-down, after `access` in PR 231/239, `storage` in PR 243 and `ZfsPool` in PR 246): migrates
  `Proxmox.NodeNetwork` off `client.ts`'s hand-rolled `pve()`/`pveHandlers` onto
  `@distilled.cloud/proxmox`'s typed `nodes.getNodeNetwork`/`createNodeNetwork`/`putNodeNetwork2`/
  `deleteNodeNetwork2`. Split into `node-network.ts` (the resource and its provider),
  `node-network-wire.ts` (the read side — `readInterfaceOrFail`/`readInterface`, `matches`,
  `attributesOf`) and `node-network-form.ts` (`NodeNetworkProps`, the write side, and the
  coercion helpers both other files need) — the storage.ts/storage-form.ts seam.

  **`Proxmox.NetworkApply` stays on `client.ts`, deliberately, not migrated with this PR.** Decision
  28/29/9 ("NetworkApply stays an operator step") plus two MEASURED reasons, checked directly
  against `@distilled.cloud/proxmox`'s own source before deciding, not assumed:

  1. `network-apply-read.ts`'s `stagedDiff` reads the ONLY signal this family has for "is anything
     staged" — `changes`, a SIBLING of `data` in PVE's own envelope
     (`{"data":[...],"changes":"<unified diff>"}`), not inside it. `@distilled.cloud/proxmox`'s
     `protocol.ts` `transformResponse` unconditionally returns `body.data ?? {}` for EVERY operation
     on the protocol, discarding any sibling field before a generated operation's typed output is
     even built. There is no typed call, current or future, that could see `changes` without a
     protocol-level change upstream in the distilled package itself.
  2. `network-apply-read.ts`'s hand-rolled `awaitTask` deliberately collapses a failed poll to
     "outcome unknown" rather than "task failed", because the member serving the poll can be the
     very node whose reload just dropped the connection the poll rides on. `@distilled.cloud/
proxmox`'s own `Task.awaitTask` (`src/task.ts`) does not have this behaviour — it propagates a
     poll failure as a genuine typed `GetNodeTaskStatusError`, which would fail `NetworkApply`'s
     `reconcile` outright on the one failure mode it most needs to tolerate.

  Both gaps are documented in `network-apply-read.ts`'s own header now, next to the functions they
  affect. Revisit when distilled's protocol layer exposes the raw envelope, or its `awaitTask` grows
  an option to treat a poll failure as unknown rather than fatal.

  **A missing interface is a 400, not a 404 and not the 500 every other migrated family has** —
  MEASURED against the live cluster (TB4 `n2`, read-role, read-only probe): `GET
/nodes/n2/network/vmbr9` answers `{"errors":{"iface":"interface does not exist"},"data":null,
"message":"Parameter verification failed.\n"}` at HTTP 400. `@distilled.cloud/proxmox` types PVE's
  400 as a genuine typed error, `ParameterVerificationFailed`, carrying the per-field `errors`
  object rather than collapsing it to an opaque `BadRequest`. Only that exact signal —
  `error.errors.iface === 'interface does not exist'` — means absent; a different 400 reason, a
  genuine 500, or a network blip all propagate as real failures rather than being read as "gone".

  **A precise absence signal does not remove the need for the dual-path read.** A first draft
  reasoned that a parsed, specific absence signal made `readXOrFail`/folding-`readX` and `read`'s
  `output`-branching unnecessary — every other migrated family carries that pair for the
  `Drift.ts` gap, but this family's absence check already rejects anything that is not the exact
  measured 400, so nothing wrongly propagates as absence. A Sonnet adversarial review caught the
  flaw: precision of the absence signal and safety of folding at a given call site are separate
  questions. Three of Alchemy's four `read` call sites (`Plan.ts`'s cold-start adoption probe,
  `Plan.ts`'s interrupted-create recovery, `Apply.ts`'s delete recovery) call `provider.read` with
  no state to compare against yet and no catch of their own around a typed failure — and `Plan.ts`
  aggregates every resource's diff/probe effects fail-fast, so one resource's malformed or
  transiently-failing declaration would abort the whole plan. Folding at those sites is what turns
  that into a normal `create`/`noop` instead. Fixed by restoring the pair:
  `readInterfaceOrFail` (non-folding, used by `diff` always and by `reconcile`'s write path) and
  `readInterface` (folding, used by `read` when `output` is `undefined`, mirroring
  user.ts/group.ts/storage.ts/zfs-pool.ts). `node-network-wire.ts`'s own header on both functions
  has the full reasoning.

  **TB4's fabric ports stay excluded, unchanged.** `tb0`/`tb1`/`dummy_c1` (the Thunderbolt mesh
  SdnFabric owns, per decision 28/29/9) were never declared through this family and still are not —
  this migration touches only how an interface this family DOES manage gets read and written, never
  what gets declared through it. The header's own warning about them is carried forward verbatim,
  now with an explicit pointer to decision 28/29/9.

  Bugs caught before opening the PR, all fixed: an early draft's `diff` forgot to call
  `unreadableWarning` on a refused-credential row (every OTHER migrated family logs it; this one
  silently didn't) — self-caught, re-running the full test suite, fixed and now covered by
  `node-network-read-failure.test.ts`'s own cries-wolf test. An unused import
  (`ParameterVerificationFailed` imported as a value, needed only as the string tag
  `Effect.catchTag` matches against) — caught by the pre-commit lint gate. And the dual-path
  regression above — caught by the adversarial review, not self-caught.

  `node-network-read-failure.test.ts` (new — this family had no dedicated test file before this
  migration, only the create-form's vendor-constraint proof in `constraints-host-forms.test.ts`)
  pins the cries-wolf fix, the precise absence signal (a genuinely new interface creates from
  exactly that 400; a different 400 and a genuine 500 both propagate instead of creating), and the
  `alchemy drift` fix. Each assertion was confirmed to fail against a deliberately weakened check
  before landing (the "different 400 propagates" test specifically catches a version of the absence
  check that matches any 400, not just the measured one).

  **Expected after this releases and the consumer bumps:** no live plan change is expected for
  `Proxmox.NodeNetwork` specifically — its `read`-role lease could always read the family's three
  declared interfaces cleanly, so this is a transport migration plus a defensive fix for a bug class
  not yet measured live for this family. `Proxmox.NetworkApply`'s own plan is unaffected, since it
  is untouched by this PR.

## 0.34.0

### Minor Changes

- [#250](https://github.com/taslabs-net/homeflare-kit/pull/250) [`0e9c010`](https://github.com/taslabs-net/homeflare-kit/commit/0e9c0109ea21ffaf142db35f6a19bd424b23b9c2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `grafana/*` ships `Grafana.ContactPoint`, `Grafana.MuteTiming` and `Grafana.MessageTemplate` — the
  first of three stacked PRs bringing Grafana alerting provisioning under Alchemy (decision 40: every
  internal alert lands in one place), on the same `@distilled.cloud/grafana@0.2.0` operations that
  unblocked `Grafana.Folder`/`Grafana.Dashboard`. `Grafana.AlertRuleGroup` and
  `Grafana.NotificationPolicy` follow in two later PRs. Full detail, including what was measured
  against the SDK's generated types versus Grafana's own docs (no live call was made in this PR):
  `docs/grafana-alerting.md`.

  **Shared across the family:** a foreign-provenance refusal (`alerting-provenance.ts`) — every
  resource reads Grafana's own `provenance` field and refuses a write when it names an owner other
  than this API (an allowlist of `""`/`"api"`, not a denylist of the known foreign values, so an
  unnamed future provenance source refuses by default). This is defense in depth: Grafana's alerting
  provisioning API also enforces it server-side, unlike the classic folder/dashboard write API. No
  resource in this family ever sets `X-Disable-Provenance` — an object this family declares stays
  owned by the declaration.

  ⛔ **Fixed after an adversarial review of this PR: the guard failed OPEN.** The first version
  mapped `live.provenance ?? ''`, so a response that simply omitted the field was indistinguishable
  from an explicit `""` (`ProvenanceNone`, writable) — a real risk for `Grafana.MuteTiming`
  specifically, whose `provenance` isn't even in the SDK's declared type and survives only through an
  unmodeled-key passthrough this house has never observed against a live response. `undefined` is now
  kept as its own value all the way through `isForeignProvenance`/`refuseIfForeignProvenance`: ONLY a
  field Grafana explicitly reports as `""` or `"api"` is writable; a missing field refuses, with a
  message that says so. Every resource has a test pinning all three cases (missing refuses, explicit
  `""` is writable, `"file"` refuses).

  **`Grafana.ContactPoint`:** no by-uid GET route exists (measured), so `fetchLive` lists every
  contact point and matches `uid` client-side rather than narrowing by the renameable `name` label. A
  secure `settings` key is never a literal prop — `secureSettingsRefs` names it, resolved from an env
  var fresh at write time and merged into `settings` only there (`secret-refs.ts`, extracted from
  `Grafana.Datasource`'s identical `secureJsonDataRefs` seam so both share one implementation).
  `matches` excludes every `secureSettingsRefs` key from comparison entirely, since Grafana's plain
  GET always redacts a secure field.
