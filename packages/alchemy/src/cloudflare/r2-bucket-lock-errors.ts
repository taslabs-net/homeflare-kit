/**
 * `Cloudflare.R2BucketLock`'s one typed refusal (S20, S21; decision 49 "upstream wins", 2026-09-24).
 *
 * ⛔ WHY ONE TAG, NOT ELEVEN. `getBucketLock`/`putBucketLock` are typed
 *   `NoSuchBucket | InvalidRoute | CloudflareOpError`, and `CloudflareOpError` alone bundles six
 *   `DefaultErrors` members (`Unauthorized`, `TooManyRequests`, `InternalServerError`,
 *   `BadGateway`, `ServiceUnavailable`, `GatewayTimeout`) plus `ConfigError`, `OAuthRefreshError`,
 *   `CloudflareError`, `CloudflareRateLimited` and `HttpClientError` — all "already typed in the
 *   SDK" per the plan, none of them a case this resource treats specially. `NoSuchBucket` is the
 *   one tag each caller handles on its own (absent on `read`, idempotent on `delete`); every other
 *   tag becomes this one typed refusal, so the resource's own error surface does not have to be
 *   re-enumerated by hand every time distilled's Cloudflare package adds another global error
 *   class — the risk a hand-written `catchTags` list of eleven names would carry.
 * ⛔ THIS IS A REMAP, NOT A CATCH-ALL SWALLOW. `Effect.mapError` only renames the failure; it
 *   never turns a failure into a success, so every one of those tags still fails the plan — just
 *   as a typed `Effect.fail`, never as the `Effect.orDie` defect that used to crash the whole
 *   engine (A `AGENTS.md:630`; the house's S20 https://github.com/alchemy-run/alchemy AGENTS.md,
 *   worded exactly the same after decision 49).
 */
import * as Data from 'effect/Data';

export type R2BucketLockOperation = 'read' | 'reconcile' | 'delete';

/**
 * `readLock`, `reconcileLock` or `deleteLock` failed with a tagged error this resource has no
 * special-case behaviour for (rate-limited, an expired credential, a Cloudflare-side 5xx, …).
 * The original SDK error — itself typed, per S21 — is kept as `cause` rather than discarded.
 */
export class R2BucketLockRefusal extends Data.TaggedError('R2BucketLockRefusal')<{
  readonly operation: R2BucketLockOperation;
  readonly bucketName: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    const causeTag =
      typeof this.cause === 'object' && this.cause !== null && '_tag' in this.cause
        ? String((this.cause as { _tag: unknown })._tag)
        : String(this.cause);
    return (
      `Cloudflare.R2BucketLock "${this.bucketName}": ${this.operation} refused ` +
      `(${causeTag}). See .cause for the underlying distilled error.`
    );
  }
}
