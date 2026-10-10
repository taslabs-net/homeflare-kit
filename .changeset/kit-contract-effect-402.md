---
'@homeflare/alchemy': patch
---

Pin `@effect/sql-d1` and `@effect/sql-sqlite-do` to 4.0.1 in the consumer contract's
`overrides` (ledger row `kit-contract-effect-402`). Measured 2026-10-09: alchemy
2.0.0-beta.81 depends on both at `^4.0.0`, and a fresh lockless install resolves 4.0.2,
whose peer is `effect ^4.0.2` — an unmet peer against the contract's effect 4.0.1 on every
fresh consumer install. The kit's own `bun.lock` held 4.0.1 only because it was locked
earlier, so the drift was invisible here. 4.0.1 peers on `effect ^4.0.1` (`npm view`), so the
exact pin holds the D1 / Durable-Object SQL resources on the version the kit is tested on;
effect stays at 4.0.1. The root `overrides` mirror the same two pins so the kit tests the
tree consumers get, and `docs/peers.md` + the smoke `PINS` carry the updated block.
