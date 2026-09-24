---
'@homeflare/alchemy': minor
---

`grafana/*` ships `Grafana.NotificationPolicy` — third and last of the stacked PRs bringing Grafana
alerting provisioning under Alchemy (decision 40), completing the family alongside
`Grafana.ContactPoint`/`Grafana.MuteTiming`/`Grafana.MessageTemplate` (kit PR 250) and
`Grafana.AlertRuleGroup` (kit PR 254). Full detail, including what was measured against the SDK's
generated types versus Grafana's own docs (no live call was made in this PR):
`docs/grafana-notification-policy.md`.

**A singleton — adopt and update only.** Measured: `RouteGetPolicyTreeError` has no `NotFound`
case, so `fetchLive` never returns `undefined` — this resource has no create or delete in the sense
every sibling resource has, only ever `PUT`-replaces the one tree an instance has. `spec.create`
exists only because `GrafanaSpec`'s shared type requires it; it is never actually reached.

**`routeResetPolicyTree` needs TWO explicit gates, not one.** `defaultRemovalPolicy: 'retain'`
means Alchemy's engine never calls `destroy` at all unless a stack opts in with
`.pipe(RemovalPolicy.destroy())` — the convention every multi-object-cascade resource in this
family already uses. On top of that, `destroy` itself refuses to reset unless the resource's own
`allowReset: true` prop is set — even a stack that opted in at the Alchemy level still needs this.
Without it, `destroy` logs a warning and retains the tree. Two gates because `routeResetPolicyTree`
is uniquely destructive here: it wipes every route, receiver reference and matcher back to
Grafana's bare default for the WHOLE instance, not one object. A test proves `destroy` sends no
`DELETE` without `allowReset`, and that a foreign-provenance tree still refuses destroy even WITH
it.

**The tree is opaque `Record<string, unknown>`**, same reasoning as `Grafana.MuteTiming`'s
`timeIntervals` — Grafana's matcher-expression types (`Matchers`/`ObjectMatchers`/`MatchRegexps`)
are complex nested unions this family does not hand-model, and the SDK's own unmodeled-key
passthrough (measured for `Grafana.MuteTiming`, mute-timing.ts's file header) means an opaque
pass-through round-trips correctly regardless.

**Route order is significant**, same as `Grafana.AlertRuleGroup`'s rules — Alertmanager routes an
alert to the first matching route in array order, proven by a test that reverses the same two
routes and asserts a mismatch. **Foreign-provenance refusal** reuses `alerting-provenance.ts`
unchanged, including the missing-means-foreign fix an adversarial review of kit PR 250 established.
**Grafana-injected defaults** are tolerated the `subset-match.ts` way (the same mechanism
`Grafana.Dashboard`/`Grafana.ContactPoint` already rely on), not hand-normalized — not measured
against a live instance, since none exists in this house to read.

**Dropped-route warning**, mirroring kit PR 254's `Grafana.AlertRuleGroup` fix for the identical
risk: a whole-tree `PUT` replaces every route, so a nested route added out-of-band is removed with
no error. `notification-policy-drop-warning.ts`'s `warnOnDroppedRoutes` logs every dropped route by
receiver and dotted-index path, from both a local reimplementation of `diff` and from `update`
itself — never a refusal, since the tree stays the unit by design.

⛔ **Fixed after an adversarial review of this PR: the identity the warning used collided across
the WHOLE TREE, not just among siblings.** The first version keyed every node by its own-fields
JSON alone in a `Set`; a duplicate route added anywhere in the tree matched an unrelated declared
node with the same fields and the drop went unwarned, even though the `PUT` still removes it —
worse than the "structural, siblings-only" limitation the original comment claimed. `FlatRoute.key`
(`notification-policy-model.ts`) is now the chain of ancestor own-fields from the root down to a
node (`\0`-joined) — order-insensitive among siblings, but distinct across different parents — and
`warnOnDroppedRoutes` counts each key as a MULTISET (live count vs. declared count) rather than
checking `Set` membership, so N identical live occurrences under one parent are dropped only past
however many the declaration itself repeats. Four tests pin this: a duplicate added live warns; a
plain sibling reorder doesn't; an identical route under a different, undeclared parent still warns;
and two declared duplicates against two live duplicates warns nothing.

Tests (`notification-policy.test.ts` + `-model.test.ts` + `-refusals.test.ts` +
`-drop-warning.test.ts`, split four ways to stay under the house's 250-line file cap, sharing
fixtures from `notification-policy-fixtures.ts`) use the family's existing `fake-grafana.ts`
harness and prove: a GET never carries a body; reconcile never sends a create-shaped write; a
foreign-provenance tree (explicit `"file"` or MISSING) refuses update while an explicit `""` is
writable; `destroy` never resets without `allowReset: true`; reordering routes shows `update`; and
the dropped-route warning's multiset identity behaves as described above.
