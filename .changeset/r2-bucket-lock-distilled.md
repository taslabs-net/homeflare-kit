---
'@homeflare/alchemy': patch
---

`Cloudflare.R2BucketLock` now calls `@distilled.cloud/cloudflare/r2`
(`getBucketLock`/`putBucketLock`) instead of the `cloudflare` npm SDK, the same
distilled package `MeshNode` already used — `catchTag('NoSuchBucket', …)` in
place of an `instanceof NotFoundError` status check. The `cloudflare` peer
dependency and `client.ts` are gone; nothing else in this package imported
them. Props, attributes and the wire body are unchanged — an adopted lock
still plans noop.
