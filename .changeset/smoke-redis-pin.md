---
'@homeflare/alchemy': patch
---

Pin `redis` to `6.3.0` in the documented `overrides` block, exact against the same class of
upstream gap measured on 2026-09-30: `redis@6.3.0` reached npm at 11:03Z minutes before its
own exact dependency `@redis/time-series@6.3.0` (published 11:12:19Z), so a lockfile-less
consumer install floating the `>=5.0.0 <7.0.0` peer of `@effect/platform-node`/`@effect/sql-pg`
to the dist-tag latest failed outright for that window. The pin sits on the now-complete 6.3.0
line and stays exact because the gap can recur with any future redis minor.
