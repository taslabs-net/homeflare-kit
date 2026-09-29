# The measured pairing

What was measured about the versions `@homeflare/seat-runtime` pins, and why they are pinned
exactly. Moved out of the [README](../README.md), which is at its line cap; nothing here was
shortened.

Measured 2026-09-29 (a scratch install, then this package's tests and smoke):

- ✅ `effect` rc.115 with `@effect/ai-openai-compat` rc.115: clean install, `tsc` 7.0.2 exit 0,
  and at runtime chat, a tool round, embeddings, three OTLP signals and `traceparent`.
- ⚠️ With `skipLibCheck: false`, compat's **own** `.d.ts` has 26 `TS2411` errors. Upstream's,
  not ours; keep `skipLibCheck: true`. `scripts/smoke.ts` allows exactly those and nothing else.
- ⚠️ compat beta.107 beside effect rc.115 also installed and passed the same small surface
  (the scout's `pairBeta`). Nothing wider was tried, so the rule stays **same exact rc**.
- 🔴 **rc.118 drops the `unstable/` prefix**: `effect/unstable/ai` becomes `effect/ai`. rc.116
  and rc.117 keep it. The estate is pinned at rc.115, so do not bump one package alone.
- 🔴 **`@effect/platform-node-shared` resolves to rc.118** under `@effect/platform-bun`
  rc.115 on a fresh install, and the process dies at import (`Cannot find module
effect/process/ChildProcess`). Only a **root** `overrides` fixes it. An `overrides` field in
  a workspace member's manifest, or in a tarball you install, is ignored (measured), which is
  why this package declares none. `scripts/smoke.ts` installs platform-bun beside it with the
  override above and asserts all three resolve to rc.115.
- ✅ `@modelcontextprotocol/sdk` 1.31.0 (the scout's measured pairing, `npm view` current on
  2026-09-29): list, call and resource read against an Effect `McpServer`. Its `zod` peer
  (`^3.25 || ^4.0`) is satisfied by the kit's zod, one copy in the lockfile, and the SDK's client
  entry, bundled with workerd's resolution conditions, imports no `node:` module (`tests/pairing.test.ts`
  asserts the zod pairing, `tests/sdk-neutral.test.ts` the bundle: it resolves the SDK's own
  dependencies too, which the first regex walk of its import lines did not).
- ✅ Live, read-only (2026-09-29, the packed tarball on CT100): `mcpToolkit` connects to LiteLLM's
  MCP gateway (`:4100/mcp`, a seat key as the bearer, an SSE reply to `initialize`) in 63 ms. ⚠️ That key
  sees **0 tools and 0 resources**, so a live tool call through `mcpToolkit` is **not measured**.
- ✅ `@effect/sql-pg` rc.115 (2026-09-29, `npm view` and a scratch install): one peer (`effect ^rc.115`)
  and no dependency: it speaks the Postgres wire protocol itself over `node:net`, so no driver package
  joins the tree. It builds and queries under Bun against Postgres 18.6, and its `.d.ts` names
  `node:stream` and `node:tls`, so a consumer with `skipLibCheck: false` and no `@types/node` sees 4
  `TS2591` errors from it (upstream's; `scripts/smoke.ts` allows exactly those).
- ⚠️ `@effect/platform-bun` rc.115 ships `BunRedis`, but this package does **not** use it: it would make
  `@effect/platform-bun` a dependency, and with it the `platform-node-shared` trap above for every
  consumer. `SeatState.valkey` is the same `send` over `Bun.RedisClient` ([state.md](./state.md)).
