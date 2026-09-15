---
'@homeflare/kit': minor
---

Add `KitError` and `kindForStatus`, and harden `parseEnv` against the `"null"` binding.

Both are ported from the estate's `@homeflare/mcp-kit`, where 34 packages proved them:

- **`isUnset`** — `''`, `"null"` and `"undefined"` all mean absent. An unbound workerd
  binding arrives as the four-character _string_ `"null"`, so code checking only for the
  empty string sends `Authorization: Bearer null` and gets a bare 401 that reads like a
  bad credential. Values are also trimmed, since a rendered env file has a trailing
  newline.
- **`kindForStatus`** — 429 maps to `rate_limited`, never to an argument error, so a
  throttled caller waits instead of rewriting a correct call.
- **`KitError`** — names the failing system, carries a remedy, and exposes `retryable`
  so a caller stops retrying a `forbidden`.
