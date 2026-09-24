---
'@homeflare/alchemy': patch
---

Make `Cloudflare.R2BucketLock` deletion succeed when its bucket is already gone.
Read, reconcile and delete now propagate distilled's typed SDK failures instead of
turning them into `Effect.orDie` defects. Error identities such as `InvalidRoute`,
`TooManyRequests` and reconcile's `NoSuchBucket` remain available to callers.

This follows the lifecycle pattern in upstream `Cloudflare/R2/BucketSippy.ts` at
`alchemy@2.0.0-beta.79` (`473c3959`): catch the missing bucket only where it means
absence or successful deletion, and propagate other SDK errors without a blanket remap.
Walked against Cloudflare API v4 via `@distilled.cloud/cloudflare@1.0.0-rc.12`,
the version pinned by Alchemy beta.79. No props, attributes or SDK pins change.

Fake-transport tests cover missing-bucket reads and deletes, missing-bucket reconcile
failures, other 404 errors, and rate-limited reads/deletes with retries disabled.
