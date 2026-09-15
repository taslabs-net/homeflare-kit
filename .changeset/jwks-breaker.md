---
'@homeflare/cloudflare': minor
---

Close a JWKS fetch amplification in `verifyAccessJwt`.

🔴 Measured on jose 6.2.12 — the version this package pins: five verifications of a
well-formed token against a **404ing** certs endpoint produced **five outbound fetches**.
jose records `jwksTimestamp` only inside the `.then()` of a _successful_ fetch, so while
an endpoint is down it refetches on every call. A Cloudflare Access outage would turn
every inbound request into an outbound one.

⚠️ No jose option fixes this — `cacheMaxAge: Infinity`, `cooldownDuration`, and both
together all give five fetches.

The fix installs a circuit breaker at jose's own exported `customFetch` seam, so jose
keeps doing the caching, cooldown, `kid` matching and verification; the breaker only adds
the one thing it does not do — remember that a fetch _failed_. A failing URL latches
closed for 30s, per URL, and a recovered endpoint clears immediately.

⛔ The breaker stores only a timestamp and an `Error`, never a `Response`. On workerd a
Response belongs to the IoContext of the request that created it, so caching one across
requests throws `Cannot perform I/O on behalf of a different request` — turning a valid
token into a 401 for every caller but the first.

Also exports `breakered` and `BREAKER_COOLDOWN_MS` for callers wrapping their own JWKS
fetches.
