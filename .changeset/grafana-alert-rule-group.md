---
'@homeflare/alchemy': minor
---

`grafana/*` ships `Grafana.AlertRuleGroup` — second of three stacked PRs bringing Grafana alerting
provisioning under Alchemy (decision 40), on the same `@distilled.cloud/grafana@0.2.0` operations
as `Grafana.ContactPoint`/`Grafana.MuteTiming`/`Grafana.MessageTemplate`. `Grafana.NotificationPolicy`
follows in one more PR. Full detail, including what was measured against the SDK's generated types
versus Grafana's own docs (no live call was made in this PR): `docs/grafana-alerting-rules.md`.

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
