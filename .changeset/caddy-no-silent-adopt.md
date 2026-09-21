---
'@homeflare/alchemy': minor
---

`CaddyConfig` in `@homeflare/alchemy/caddy` no longer adopts a running Caddy silently. In 0.7.0, the first read adopted whatever config a Caddy was running, and the next apply loaded over it.

Behaviour changes:

- With no state, the first read is Alchemy's adoption probe. A Caddy whose running config is the declared one is adopted as-is, and nothing is loaded. A Caddy serving nothing (`null`, or no apps) plans a create. Any other config reads as `Unowned`, so the plan refuses it unless the deploy runs with `--adopt`. A Caddyfile that cannot be compared at probe time also reads as `Unowned`, with a warning saying why, never an error: the engine replays this read to recover an interrupted create, and an error would fail every later plan.
- Where Alchemy skips that probe (props holding an Output, as on `caddyWithFile()`'s first deploy), the apply refuses the same takeover before any `/load` (the HostFile is written by then). It resolves adoption as the planner does: the resource's own `adopt(…)`, else `--adopt`. So `.pipe(adopt(false))` still refuses under `--adopt`, and `.pipe(adopt(true))` takes over without it.
- The state vouches only for the Caddy it was applied to. When the transport now reaches a Caddy at another endpoint, the apply needs adoption (`--adopt`, or the resource's `adopt(true)`) unless that Caddy runs the config the state last stored, the declared one, or nothing.

Docs: `docs/caddy.md` has the adoption table, and records that managed Caddies run `caddy run --resume` with their own `XDG_CONFIG_HOME`, set in the launchd job rather than the envfile. A restart then runs the last config Caddy accepted, and after a resumed start SIGUSR1 has no file to reload. The admin endpoint section moves to `docs/caddy-admin.md`, and the README's reasons for each peer and override pin move to `docs/peers.md`.
