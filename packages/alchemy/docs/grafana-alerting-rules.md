# `Grafana.AlertRuleGroup` — `@homeflare/alchemy/grafana`

Second of three stacked PRs bringing Grafana alerting provisioning under Alchemy
([grafana-alerting.md](./grafana-alerting.md) covers the first: `Grafana.ContactPoint`,
`Grafana.MuteTiming`, `Grafana.MessageTemplate`). Branched fresh off `main` after that PR merged,
so this is its own diff, not stacked on it. No live call was made writing this PR.

## The unit: group, not rule

MEASURED against the SDK's generated operations: `PUT /v1/provisioning/folder/{FolderUID}/
rule-groups/{Group}` (`routePutAlertRuleGroup`) takes the evaluation `interval` AND the full
ordered `rules[]` TOGETHER, replacing the whole group in one call. The individual
`routePostAlertRule`/`routePutAlertRule` operations have no `interval` field at all and cannot
reorder rules within a group — declaring rules one at a time would leave a group's interval and
rule order either undeclarable or racy across N independent resources with no shared source of
truth. Grafana's own docs describe `X-Disable-Provenance` on the rule-group PUT as setting "the
provenance for the rule group and all its alert rules" — the group, not the rule, is Grafana's own
natural unit here. Mirrors Terraform's `grafana_rule_group` resource, which takes the identical
shape.

## Example

```ts
import { GrafanaAlertRuleGroup, grafanaProviders } from '@homeflare/alchemy/grafana';

export class InfraAlerts extends GrafanaAlertRuleGroup('infra-alerts', {
  folderUid: 'infra',
  group: 'default',
  interval: 60,
  rules: [
    {
      uid: 'high-cpu',
      title: 'High CPU',
      condition: 'A',
      data: [/* … AlertQuery, the SDK's own shape … */],
      for: '5m',
      noDataState: 'NoData',
      execErrState: 'Alerting',
    },
  ],
}) {}
```

## `uid` is required on every declared rule

Same doctrine as every other resource in this family. `ProvisionedAlertRuleInput.uid` is optional
on the wire (Grafana assigns one if omitted), but locating a specific rule this resource didn't
just create would then mean matching by title — the ambiguity `resource.ts`'s header and netbox's
`soleMatch` exist to catch everywhere else in this family.

## Rule order is significant, never reordered

`subset-match.ts`'s array comparison is already position-significant (exact length, then
element-wise) — this resource relies on that as-is. Declaring rules in a different order than what
is live is a genuine content change (Grafana evaluates and displays a group's rules in array
order), proven by a dedicated test (`alert-rule-group.test.ts`) that declares the same two rules
reversed and asserts `matches` is `false`.

## Dropped-rule warning — accepted, never silent

⚠️ **Flagged by an adversarial review of this PR.** A whole-group `PUT` replaces the entire rule
list — a live rule with no counterpart in the declaration (a human adding one in the Grafana UI
minutes before a deploy, ordinary writable provenance, nothing for the refusal above to catch) is
removed with no error, and `diff` has no distinct action to report a lossy update under
(`alchemy/Diff`'s `Diff` type is exactly `NoopDiff | UpdateDiff | ReplaceDiff`). This is accepted
by design — the group is still the unit — but never silent:
`alert-rule-group-drop-warning.ts`'s `warnOnDroppedRules` logs a loud `Effect.logWarning` naming
every dropped rule by title and uid, called from BOTH this resource's custom `diff` (so
`bun run plan` shows it before anything is written) and from `update` itself (so it is visible
wherever `reconcile` runs directly too). Mirrors the house pattern
`proxmox/unreadable-read.ts`'s `unreadableWarning` established.

`diff` is a LOCAL reimplementation of `resource.ts`'s generic `grafanaOperations(spec).diff`, not a
wrap of it — the generic version has no seam to run a side effect against the live rules it reads,
and wrapping it would mean fetching live twice just to see what it already saw. This is the only
resource in the family that needs this; every other resource still uses the shared engine
unmodified.

## Volatile-field normalization (`alert-rule-group-model.ts`)

`normalizeRule` strips three fields before ANY comparison, each measured against
`ProvisionedAlertRule`/`ProvisionedAlertRuleInput`:

- `id` — the internal numeric row id. Exists only on the READ shape, absent from the WRITE shape —
  confirms it is Grafana-managed, never declarable.
- `updated` — a server-set timestamp. Same evidence: read-only shape only.
- `provenance` — read-only too, but handled by the foreign-provenance refusal below rather than
  compared for drift: an object this family just wrote reads back `provenance: "api"`, which the
  declaration never sets, so comparing it would show a false `update` on every rule this family
  owns.

`folderUID`/`ruleGroup`/`orgID` are forced to the group's own canonical values (mirrors
`dashboard-model.ts`'s `normalizeModel` forcing `uid`) — a rule's declaration never repeats its own
group/folder. ⚠️ `orgID` defaults to `1`, not measured against a multi-org instance (none exists in
this house yet); a rule's own spec functions have no access to `GrafanaTarget.orgId` the way
credentials do.

## Foreign-provenance refusal — per rule, whole-group refuse

Unlike `ContactPoint`/`MessageTemplate`, the `AlertRuleGroup` type itself (what
`routeGetAlertRuleGroup` returns) carries NO top-level `provenance` field — measured:
`folderUid?`/`interval?`/`rules?`/`title?` only. Each RULE inside `rules[]` has its own
(`ProvisionedAlertRule.provenance`), and Grafana's docs say a new rule's provenance "must match the
provenance value configured for its rule group" — so this resource checks every live rule via
`alerting-provenance.ts`'s shared `isForeignProvenance`/`refuseIfForeignProvenance` and refuses the
WHOLE group's write if ANY rule carries a foreign provenance, naming the first one found. An empty
live group (no rules yet) has nothing to check and is never foreign. The same "missing means
foreign, never `ProvenanceNone`" fail-closed rule kit PR 250's adversarial review established
applies here unchanged — pinned by `alert-rule-group-provenance.test.ts`.

## A declared group whose folder does not exist — refuses, never auto-creates

This resource makes no "does the folder exist" call of its own and does not depend on or invoke
`Grafana.Folder`'s create path. Measured: `RoutePutAlertRuleGroupError` is
`BadRequest | Forbidden | GrafanaOpError` — no `NotFound` case at all — so a nonexistent
`folderUid` fails the PUT as a typed `BadRequest`, left uncaught and propagated, which fails the
whole `reconcile` and stops the deploy. Declare a `Grafana.Folder` for it first; the two resources
sharing one `folderUid` string is the dependency. Auto-creating a folder from inside this resource
would blur ownership the same way `provisioned.ts`'s "one owner per resource" principle already
guards against elsewhere in this family. ⚠️ Not re-measured against a live instance — inferred from
the declared error union, the same evidentiary bar `folder.ts`'s own `version` note uses.

## Delete defaults to `retain`

Deleting a group deletes every rule in it in one call (`routeDeleteAlertRuleGroup`) — the same
multi-object-cascade class `Grafana.Folder`/`openbao/mount.ts` already guard with
`defaultRemovalPolicy: 'retain'`. A stack that wants the cascade opts in with
`.pipe(RemovalPolicy.destroy())`.

## Tests

`alert-rule-group.test.ts` (fetchLive/create/reconcile/order/update/destroy),
`alert-rule-group-model.test.ts` (pure `normalizeRule`/`toWireRule`),
`alert-rule-group-provenance.test.ts` (foreign, missing, explicit-none, empty-group) and
`alert-rule-group-drop-warning.test.ts` — split four ways to stay under the house's 250-line file
cap, sharing fixtures from `alert-rule-group-fixtures.ts`. Prove: a GET never carries a body; a
nonexistent folder propagates `BadRequest` rather than being folded to absent or silently creating
one; a foreign-provenance rule (explicit `"file"` or MISSING) refuses the whole group's
update/destroy while an explicit `""` is writable; reordering the same rules shows `update`; an
unchanged declaration is a noop despite `id`/`updated`/`provenance` differing on every rule; and —
`alert-rule-group-drop-warning.test.ts`, added after an adversarial review — a live rule the
declaration doesn't mention is named by title and uid in a logged warning from both `diff` and
`update`, and nothing is warned when every live rule is declared.
