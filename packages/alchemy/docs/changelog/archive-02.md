# Alchemy changelog archive 2

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

The read (the directory index, `nodes.listNodeCephFs`) and the create (`nodes.updateNodeCephFs` —
distilled's generator MISNAMES the create a "update"; checked directly against its `T.Http`
annotation, it is genuinely `POST /nodes/{node}/ceph/fs/{name}`, PVE's only write on that path,
harmless once named for what it is) both move to a new `ceph-fs-distilled.ts`. The create's forked-
worker wait is its OWN function there, polling the RAW `nodes.getNodeTaskStatus` operation directly
rather than `@distilled.cloud/proxmox`'s own `Task.awaitTask` — checked against `task.ts` before
deciding: `Task.awaitTask` propagates a poll failure as a genuine typed error instead of treating
it as "not settled yet", which would turn a missing `Sys.Audit` grant or a node mid-restart into a
failed create instead of a patient one, the same failure mode `Proxmox.NetworkApply`'s own header
already names. The raw operation carries none of that behaviour — it is a plain typed GET — so
wrapping it in the SAME tolerant retry loop `ceph-fs-wire.ts`'s own (unmigrated, delete-only) poll
already uses reproduces the exact policy: same cadence (`POLL_SECONDS`/`POLL_ATTEMPTS`, one
constant, imported not retyped), same "an unreadable status is not a failure" tolerance.

**Live measurement note.** This session's own OpenBao policy has no Proxmox grant; the live probes
above ran through `homeflare-proxmox`'s `scripts/with-mini-bao.ts` (the `macmini-agent` AppRole's
`read` role for TB4), from a detached worktree, read-only, per the coordinator's direction — not
through this repo's own credentials, and nothing here reads one.

**One distilled generator quirk recorded to the shared `distilled-sdk-path.md` memory**, since it
is an upstream-distilled fact rather than a kit one: `DeleteNodeCephFsRequest` types
`remove_pools`/`remove_storages` as `T.Body` on a DELETE, which PVE's own server never reads a
body on — the same class of finding as `Proxmox.NetworkApply`'s two, worth the same upstream
attention if `@distilled.cloud/proxmox` is ever patched again.

**New tests**, every one proven against a deliberately weakened check before landing:
`ceph-pool-write.test.ts` (a genuinely new pool creates once the index is confirmed empty; the
PG-merge guard refuses a create when the index lists the name but the status read still fails —
confirmed this fails without the guard by temporarily removing the `confirmAbsent` call and
re-running; `RemovalPolicy.destroy()` then undeclaring sends exactly one DELETE) and
`ceph-fs-write.test.ts` (a genuinely new filesystem POSTs, polls a forked task that answers
`running` before `stopped`/`OK` — proving the poll loop actually loops — and reads the index back;
a task that finishes with a real Ceph error dies with the task-log pointer rather than a false
create).

**`ceph-fs-delete.test.ts` (new, added after the adversarial review's finding).** The review's one
substantive finding: `Proxmox.CephFs`'s `delete` handler is the single place in this PR that
composes a distilled call (`readFs`, before and after) with the unmigrated hand-client one
(`destroyFs`) inside one handler — the exact boundary this PR's whole design rests on — and that
composition had zero test coverage anywhere in the repo, before or after the rest of this PR
(each half was proven separately, never together, and the destroy is destructive and hard to
reverse). Added two tests: a genuine `RemovalPolicy.destroy()` then undeclare, confirmed to fail
(the read-back reports the filesystem still present) by temporarily removing the `destroyFs` call
and re-running; and a filesystem removed by hand between the adopt and the undeclare, proving
`delete` is a silent no-op rather than a false DELETE against an object already gone.

**Expected after this releases and the consumer bumps:** no live plan change for either family —
C1's read-role lease could always read the live Ceph objects cleanly, so this is a transport
migration on tested paths, not a behaviour change.

- [#261](https://github.com/taslabs-net/homeflare-kit/pull/261) [`ee3f452`](https://github.com/taslabs-net/homeflare-kit/commit/ee3f4526d8fa2991837a8d7931b2fb37df921eda) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `@distilled.cloud/litellm` (interim, via `packages/distilled-litellm`): reverts `credentials.ts`
  to `Effect.orDie` on a missing or misspelled `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY`.

  Q6 of the 2026-09-24 walk-down (decision 49 "upstream wins"): distilled's own convention for a
  missing credential is `Effect.orDie`, not a typed `ConfigError` — 73 of 80 `packages/*/src/credentials.ts`
  end this way at `homeflare/base`, 78 of 80 at `origin/main`. A worktree commit (`4ad19154`) had
  made LiteLLM's `Credentials` the one exception, declaring `Effect.Effect<Config, ConfigError>` and
  dropping the `orDie`. Distilled is not silent on this convention, so the divergence was the house
  going stricter than distilled's own practice on a point it already has an answer for — the thing
  decision 49 says to stop doing. Reverted in the litellm worktree (`homeflare/litellm`
  `cbd6bbb890066e57fb0224b96c27fca91d89e0a6`, a `git revert` of `4ad19154`, confirmed byte-identical
  to `4ad19154`'s parent), gated on `typecheck:ci`/`specs:check`/`format:check`, then byte-copied
  into `packages/distilled-litellm/src/credentials.ts` (confirmed with `diff -rq` against the
  worktree's `src/`).

  **The typed-error idea is not discarded**, just not spread further: it is written up as a HELD
  upstream proposal in [`litellm.md`](../packages/alchemy/docs/litellm.md#credentials) — distilled's
  own `LitellmOpError` already declares `ConfigError` and threads a real credentials failure into an
  operation's error channel, so the plumbing for a typed refusal genuinely exists; nobody has raised
  it to `alchemy-run/distilled`, and this PR doesn't either.

  **`packages/alchemy/src/litellm/operations.ts`'s `mutate` helper needed no functional change.**
  Its `| ConfigError` widening was always redundant with the operation-level `LitellmOpError` union
  (which declares `ConfigError` unconditionally, regardless of `Credentials`'s own type) — confirmed
  by re-reading `protocol.ts` — so it still typechecks and the widening is still a real no-op for
  callers. Its comment is corrected: it no longer claims resolving `Credentials` can itself fail
  typed, since post-revert it cannot.

  **Verified**: `bun run build:interim-packages`, `tsc --noEmit` for the whole `@homeflare/alchemy`
  package, `bun test src/litellm` (28/28), and `packages/distilled-litellm`'s own `types` and
  `smoke` — all clean.

  No live plan change: this only affects what happens when the two env vars are missing or
  misspelled, which was never a state this family's tests exercised as "succeeds."

- [#266](https://github.com/taslabs-net/homeflare-kit/pull/266) [`c6f3f9a`](https://github.com/taslabs-net/homeflare-kit/commit/c6f3f9a33fa2ed72c5d73586fa74090582330cd0) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Make `Cloudflare.R2BucketLock` deletion succeed when its bucket is already gone.
  Read, reconcile and delete now propagate distilled's typed SDK failures instead of
  turning them into `Effect.orDie` defects. Error identities such as `InvalidRoute`,
  `TooManyRequests` and reconcile's `NoSuchBucket` remain available to callers.

  This follows the lifecycle pattern in upstream `Cloudflare/R2/BucketSippy.ts` at
  `alchemy@2.0.0-beta.79` (`473c3959`): catch the missing bucket only where it means
  absence or successful deletion, and propagate other SDK errors without a blanket remap.
  Walked against Cloudflare API v4 via `@distilled.cloud/cloudflare@1.0.0-rc.12`,
  the version pinned by Alchemy beta.79. No props, attributes or SDK pins change.

  Fake-transport tests cover missing-bucket reads and deletes, missing-bucket reconcile
  failures, other 404 errors, and rate-limited reads/deletes with retries disabled.

## 0.36.0

### Minor Changes

- [#255](https://github.com/taslabs-net/homeflare-kit/pull/255) [`74310b5`](https://github.com/taslabs-net/homeflare-kit/commit/74310b5fcbd6ab1ddbebe607c2693c34d664bf30) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `grafana/*` ships `Grafana.NotificationPolicy` — third and last of the stacked PRs bringing Grafana
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

## 0.35.0

### Minor Changes

- [#254](https://github.com/taslabs-net/homeflare-kit/pull/254) [`e6788af`](https://github.com/taslabs-net/homeflare-kit/commit/e6788af70a34495af64d9bc0a4fce112e59bf561) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `grafana/*` ships `Grafana.AlertRuleGroup` — second of three stacked PRs bringing Grafana alerting
  provisioning under Alchemy (decision 40), on the same `@distilled.cloud/grafana@0.2.0` operations
  as `Grafana.ContactPoint`/`Grafana.MuteTiming`/`Grafana.MessageTemplate`. `Grafana.NotificationPolicy`
  follows in one more PR. Full detail, including what was measured against the SDK's generated types
  versus Grafana's own docs (no live call was made in this PR): `docs/grafana-alerting-rules.md`.
