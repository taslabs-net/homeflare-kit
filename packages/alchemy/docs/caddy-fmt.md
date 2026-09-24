# Formatting a Caddyfile — `formatCaddyfile()`

`caddy fmt` is a CLI-only feature (`cmd/commandfuncs.go`); nothing under `/adapt`, `/load` or any
other admin endpoint formats a Caddyfile — measured 2026-09-24. `formatCaddyfile(text)` shells out
to the LOCAL `caddy` binary instead — `caddy fmt -`, the text on stdin, the formatted text on
stdout — the same formatter the CLI command runs. It never reimplements the Caddyfile grammar's
formatting rules in TypeScript.

```ts
import * as Effect from 'effect/Effect';
import { layer as BunServicesLayer } from '@effect/platform-bun/BunServices'; // or platform-node's
import { formatCaddyfile } from '@homeflare/alchemy/caddy';

const formatted = await Effect.runPromise(
  formatCaddyfile(caddyfile).pipe(Effect.provide(BunServicesLayer)),
);
```

| failure            | when                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `CaddyFmtNotFound` | the binary is not on `PATH` (or not executable)                                    |
| `CaddyFmtFailed`   | it ran but exited non-zero — a syntax error in the text, most likely               |
| `PlatformError`    | anything else the OS reported spawning it (a permission problem, a killed process) |

⛔ **Never silently skipped.** A missing or failing binary always fails the Effect — there is no
fallback path that returns the input back unformatted. Point at a specific build with
`{ binaryPath }` (default: `DEFAULT_CADDY_BINARY`, i.e. `caddy`, resolved on `PATH`) — ideally the
exact one the target Caddy runs, since `caddy fmt`'s own output can change between versions.

Requires `ChildProcessSpawner` in scope (S19: no `node:child_process`, no `async`/`await`) —
`@effect/platform-bun`'s or `@effect/platform-node`'s layer, or anything smaller that provides
just that service.

## Why it matters: the adapter's own warning

Caddy's Caddyfile adapter warns `Caddyfile input is not formatted` on **every** unformatted input
(`adapter.go` `FormattingDifference`) — not an edge case, the common one. That warning shares the
`/load` response body with the refused-but-200 trap [caddy.md](./caddy.md)'s digest note and
admin-calls.ts's module doc describe, so on its own it is easy to miss among other diagnostics.

`Caddy.Config`'s plan (`diffConfig`) and deploy (`reconcile`) both pull it out of the warning list
and log it as its own clear line naming the fix, separately from any other adapter warnings:

> `Caddy.Config at <endpoint>: Caddyfile is not formatted — run `caddy fmt` on it, or format it
with this package's formatCaddyfile() before declaring it, to silence this warning.`

Before this, the warning was invisible at plan time (never logged at all) and, at deploy time,
just one more line among the rest — easy to read past.

★ **Formatting should never change the adapted JSON, so it should never cause drift.** `digest.ts`
compares the adapted config; `caddy fmt` only changes whitespace and brace style in the Caddyfile
TEXT, and the Caddyfile grammar treats runs of whitespace as plain token separators outside a
quoted value, so re-flowing them should not change the token stream `/adapt` produces from it.
⚠️ **Reasoned, not measured against a real Caddy in this repo** — this package has no caddy binary
to adapt both forms and diff the JSON against. homeflare-mini's own "adapts with zero warnings"
test (its own docs) is where that gets checked against a real `/adapt` call, on real rendered
Caddyfiles. Running a declared Caddyfile through `formatCaddyfile()` before handing it to
`CaddyConfig` silences the warning; it is not expected to ever show up as an update on the next
plan, but that expectation rests on the grammar, not on a measurement taken here.
