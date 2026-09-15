---
'@homeflare/kit': minor
---

Add `rateLimitAware`, a ky hook that honours `x-ratelimit-reset-after`.

Measured against ky 2.1.0: `retry-after: 1` is honoured (waited 1006ms) but
`x-ratelimit-reset-after: 1` is **ignored** (303ms — ky's own backoff). Discord and
Discord-shaped APIs send the latter, with fractional seconds, and it is the more precise
of the two when both appear.

```ts
import { client, rateLimitAware } from '@homeflare/kit';
const discord = client(base, rateLimitAware);
```

Also exports `retryAfterMs` and `MAX_RETRY_WAIT_MS` for callers doing their own waiting.
The wait is capped at 30s: an uncapped sleep on a global 429 can be an hour, which is
indistinguishable from a hang.
