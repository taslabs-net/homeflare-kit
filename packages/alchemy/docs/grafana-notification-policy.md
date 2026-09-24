# `Grafana.NotificationPolicy` — `@homeflare/alchemy/grafana`

Third and last of the stacked PRs bringing Grafana alerting provisioning under Alchemy
([grafana-alerting.md](./grafana-alerting.md): `Grafana.ContactPoint`/`Grafana.MuteTiming`/
`Grafana.MessageTemplate`; [grafana-alerting-rules.md](./grafana-alerting-rules.md):
`Grafana.AlertRuleGroup`). Branched fresh off `main` after that PR merged. No live call was made
writing this PR.

## A singleton — adopt and update only

`GET`/`PUT /v1/provisioning/policies` always address the one tree an instance has; there is no path
parameter. MEASURED: `RouteGetPolicyTreeError` is `Forbidden | GrafanaOpError` — no `NotFound` case
at all, so `fetchLive` never returns `undefined`. `reconcile`'s `before === undefined` branch
(`resource.ts`) is therefore dead code for this resource: there is no create in the sense every
other resource in this family has, and `spec.create` exists only because `GrafanaSpec.create` is a
required field on the shared type — implemented as the same `PUT` `update` sends, defensively,
never actually reached.

## Two gates before `routeResetPolicyTree` ever runs

`destroy` never calls `routeResetPolicyTree` unless `allowReset: true` is explicitly declared — a
gate independent of Alchemy's own removal policy:

1. **`defaultRemovalPolicy: 'retain'`** — the same convention every multi-object-cascade resource
   in this family uses (`Grafana.Folder`, `Grafana.AlertRuleGroup`, every `Bao.*`). Alchemy's own
   engine never calls this resource's `delete` handler at all unless a stack opts in with
   `.pipe(RemovalPolicy.destroy())`.
2. **`allowReset` (a prop, not a stack-level policy)** — even a stack that HAS opted into destroy
   at the Alchemy level still needs this resource's own explicit `allowReset: true` before
   `destroy` will actually reset. Without it, `destroy` logs a warning and returns — retained.

Two gates, not one, because `routeResetPolicyTree` is uniquely destructive among everything this
family calls: it wipes every declared route, receiver reference and matcher back to Grafana's own
bare default, for the WHOLE instance, not one object. A test
(`notification-policy-refusals.test.ts`) proves `destroy` sends no `DELETE` without `allowReset`,
and a foreign-provenance tree still refuses `destroy` even WITH `allowReset: true`.

## The tree is opaque `Record<string, unknown>`

Same reasoning as `mute-timing.ts`'s `timeIntervals`: Grafana's `Matchers`/`ObjectMatchers`/
`MatchRegexps` (matcher expression shapes) are complex nested union/array types this family does
not attempt to model field-by-field. This family's own measured passthrough behavior
(`mute-timing.ts`'s file header) means an opaque pass-through round-trips correctly regardless.

## Route order is significant

Same as `Grafana.AlertRuleGroup`'s rules: `subset-match.ts`'s array comparison is
position-significant, and Alertmanager itself routes an alert to the FIRST matching route in array
order — reordering routes is a genuine routing change, proven by a test that declares the same two
routes reversed and asserts a mismatch.

## Foreign-provenance refusal

Unchanged from kit PR 250/254, including the missing-means-foreign fix: `Route.provenance` is
optional on the wire, and `undefined` is never folded into `""`. `create` is never at risk — it is
unreachable (above).

## Grafana-injected defaults — tolerated the `declaredContentMatches` way

`matches()` runs the (`provenance`-stripped) declared and live trees through `subset-match.ts`'s
tolerant-subset comparison — the same mechanism `Grafana.Dashboard`'s panel-`datasource`
auto-decoration and `Grafana.ContactPoint`'s settings defaults already rely on: a live tree may
carry additional fields, at any depth, the declaration never mentioned (a default
`group_wait`/`group_interval`/`repeat_interval`/`group_by: []` Grafana injects when the declaration
omits them is the plausible case) without failing the match. ⚠️ Not measured against a live
instance — no live policy tree exists in this house to read — the documented, conservative default
every unmeasured value shape in this family takes.

## Dropped-route warning — accepted, never silent

Same fix kit PR 254 made for `Grafana.AlertRuleGroup`, applied here: a whole-tree `PUT` REPLACES
every route, so a nested route added out-of-band is removed with no error and no distinct `Diff`
action to report it under. `notification-policy-drop-warning.ts`'s `warnOnDroppedRoutes` logs every
dropped route by receiver and dotted-index path, called from both a local reimplementation of
`diff` and from `update` itself — mirrors `alert-rule-group-drop-warning.ts` exactly, including
being a LOCAL reimplementation of `resource.ts`'s generic `diff` rather than a wrap of it (no seam
in the generic version for this side effect without fetching live twice).

⚠️ **Identity is structural, not a stable key** — Grafana's policy routes have no id/uid.
`FlatRoute.key` (`notification-policy-model.ts`) is the chain of ancestor own-fields from the root
down to a node, `\0`-joined: two nodes are "the same" only under the identical lineage of parents,
which makes an identical route under a DIFFERENT parent correctly distinct while staying
order-insensitive among siblings (a shared parent contributes the same key to every child
regardless of index) — reordering the same routes logs nothing, only genuine removal does.

⛔ **Fixed after an adversarial review of this PR: the first version's identity collided across the
WHOLE TREE, not just among siblings.** A plain `Set` of every node's own-fields JSON meant a
duplicate route added anywhere (e.g. a second `severity=warning -> slack` alongside an
already-declared one) matched the existing `Set` entry and went unwarned, even though the `PUT`
still drops it — worse than the "siblings only" limitation the original comment claimed. Every key
is now counted as a MULTISET (declared count vs. live count) rather than checked for membership: a
key is "dropped" only for the amount its live count exceeds its declared count, so N identical live
occurrences under the same parent are dropped only past however many the declaration itself
repeats — proven by four tests: a duplicate added live warns; a plain sibling reorder doesn't; an
identical route under a different, undeclared parent still warns (distinct lineage); and two
declared duplicates against two live duplicates warns nothing (counts match).

## Example

```ts
import { GrafanaNotificationPolicy, grafanaProviders } from '@homeflare/alchemy/grafana';

export class Policy extends GrafanaNotificationPolicy('estate-policy', {
  route: {
    receiver: 'default-receiver',
    group_by: ['alertname'],
    routes: [
      { receiver: 'pagerduty', matchers: ['severity=critical'] },
      { receiver: 'slack', matchers: ['severity=warning'] },
    ],
  },
}) {}
```

## Tests

`notification-policy.test.ts` (fetchLive/reconcile/order), `notification-policy-model.test.ts`
(pure `normalizeRoute`/`flattenRoutes`), `notification-policy-refusals.test.ts` (provenance +
reset-gate) and `notification-policy-drop-warning.test.ts` — split four ways to stay under the
house's 250-line file cap, sharing fixtures from `notification-policy-fixtures.ts`. Prove: a GET
never carries a body; reconcile never sends a create-shaped write; a foreign-provenance tree
(explicit `"file"` or MISSING) refuses update while an explicit `""` is writable; `destroy` never
resets without `allowReset: true`, and still refuses a foreign tree even with it; reordering routes
shows `update`; a live route the declaration doesn't mention is named in a logged warning from both
`diff` and `update`, while a plain reorder logs nothing; and — the multiset fix — a duplicate route
added live warns while an identical declared/live duplicate pair doesn't, and an identical route
under a different, undeclared parent is still correctly reported as dropped.
