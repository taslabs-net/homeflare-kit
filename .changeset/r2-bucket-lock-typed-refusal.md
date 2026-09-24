---
'@homeflare/alchemy': patch
---

`Cloudflare.R2BucketLock` (WI-7 of the 2026-09-24 upstream walk-down, decision 49 "upstream wins"):
`deleteLock` is now idempotent, and `readLock`/`reconcileLock`/`deleteLock` no longer end in
`Effect.orDie`.

**`deleteLock` catches `NoSuchBucket` into success.** A bucket that is already gone has nothing
left to unlock — S11/P10 (`delete` is idempotent: not-found is success), the same shape `readLock`
already gave `NoSuchBucket` on the read side. Previously a retirement path that ran `delete` twice
(or once after someone removed the bucket by hand) would crash the engine on the second call.

**No more `Effect.orDie` anywhere in this file.** `getBucketLock`/`putBucketLock` are typed
`NoSuchBucket | InvalidRoute | CloudflareOpError` in `@distilled.cloud/cloudflare/r2`
(`1.0.0-rc.12`, the version `alchemy@2.0.0-beta.79` pins) — already typed in the SDK, so no
distilled patch was needed. A new `R2BucketLockRefusal` (`r2-bucket-lock-errors.ts`) is the one
local tag every other member of that union remaps to via `Effect.mapError`, keeping the original
SDK error as `.cause`. This is a remap, not a swallow: every one of those tags still fails the
plan, just as a typed `Effect.fail` — visible in `alchemy plan`/`apply` output — never as the
`Effect.orDie` defect that used to crash the whole engine (upstream `AGENTS.md:630`; the house's
S20, reworded to match it exactly under decision 49).

`R2BucketLockProvider` moved to its own file (`r2-bucket-lock-provider.ts`) so
`r2-bucket-lock.ts` stays under the house's 250-line cap once the typed-error wiring landed (S3).

**Tests** (`r2-bucket-lock.test.ts`): deleting when the bucket is already gone now succeeds
(previously asserted a crash via `Cause.hasDies`); a rate-limited read and a rate-limited delete
each surface as `R2BucketLockRefusal` with `.cause._tag === 'TooManyRequests'`, run under
`@distilled.cloud/cloudflare/Retry`'s `none` policy so the test does not wait out distilled's real
throttling backoff (S26, `testing-speed-doctrine`); the pre-existing `InvalidRoute`-not-swallowed
and `reconcileLock` NoSuchBucket-propagates tests now assert the typed tag instead of a defect.

No live plan change: this is an error-handling change on paths that already worked when nothing
failed.
