---
'@homeflare/alchemy': minor
---

Added `caddy/formatCaddyfile(text)`: pipes a Caddyfile through the LOCAL
`caddy fmt -` binary (stdin in, formatted text out) — the same formatter the
`caddy fmt` CLI command runs. There is no admin API endpoint for this
(`cmd/commandfuncs.go` is CLI-only), so it shells out with
`ChildProcessSpawner` (S19) rather than going through `@distilled.cloud/caddy`,
and it never reimplements the formatter in TypeScript: a missing or failing
binary fails the Effect with a typed `CaddyFmtNotFound` / `CaddyFmtFailed`,
it never silently returns the input unformatted.

Also: `Caddy.Config`'s plan (`diffConfig`) and deploy (`CaddyConfigProvider`'s
`reconcile`) now surface the adapter's "Caddyfile input is not formatted"
warning as its own clear line naming the fix, separately from any other
adapter warnings — it used to be silent at plan time, and just another line
in the pile at deploy time. Nothing here changes what gets loaded onto Caddy:
formatting should never change the adapted JSON digest.ts compares (reasoned
from the Caddyfile grammar; not measured against a real Caddy in this
package — see docs/caddy-fmt.md).
