---
'@homeflare/alchemy': patch
---

Pin `redis` to `6.2.1` in the documented `overrides` block: `redis@6.3.0` hit npm at
2026-09-30T11:03Z without its own exact dependency `@redis/time-series@6.3.0` (latest stays
`6.2.1`), so a lockfile-less consumer install floating the `>=5.0.0 <7.0.0` peer of
`@effect/platform-node`/`@effect/sql-pg` to the dist-tag latest failed outright. Lift the pin
only when upstream's 6.3.0 line is complete (every `@redis/*` sub-package published).
