---
'@homeflare/alchemy': minor
---

**New: `hf-adopt-verify` and `@homeflare/alchemy/verify` — prove a deploy's adoptions are no-ops
before it runs.** Alchemy prints `adopted` for an object that already matches and for one that
drifts alike (beta.79 `Plan.ts` turns the diff's `noop` into an update after the adoption probe),
and the deploy reconciles both. The verifier plans the stack with Alchemy's own planner, with
every provider watched and every write path refused. For each row without a state row it reports
the provider's `read`, its own `diff` before the engine forced it, and the declared fields that
differ (names only). It exits `0` only when all are no-ops, `1` when any is not, `2` when the plan
could not be computed.

```sh
bunx --bun hf-adopt-verify --config alchemy.run.ts --stage live [--all] [--json]
```

`verifyStack(target)` and `verifySession({ stack, context })` are the same thing as functions.

**Fix: adopting a `Proxmox.CephPool` that already matches no longer writes.** Its reconcile PUT
`setpool` whenever the pool existed, so every adoption forked a `cephsetpool` worker under the
provision token. On TB4 that was six tasks, one per pool, on 2026-09-13 and 2026-09-20. It now
skips the PUT when its own `matches` holds, like every other PVE/PBS family. The predicate is
shared in one place (`update-guard.ts`). `docs/adopted-deploys.md` traces what a deploy of an
adopted row does for every family the Proxmox and PBS stacks use.
