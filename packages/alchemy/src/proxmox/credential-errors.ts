/**
 * `credentials.ts`'s one typed mint failure (S21) — split out to keep that file under the
 * 250-line cap once this class grew a real header (2026-09-24, the cries-wolf fix).
 */
import * as Data from 'effect/Data';

/**
 * OpenBao answered 403 to `GET /v1/<mount>/creds/<tier>`: this identity's AppRole has no grant
 * for `tier` on `mount` — measured 2026-09-24 as "the agent lane cannot mint `provision`" (the
 * lane's policy grants `read` but not `provision`). A TYPED tag, not the plain `Error` every
 * other mint failure still is (404 no such role/mount, 503 sealed, a network failure), because
 * this ONE case means "refused, not evidence of anything about the object" — a family's
 * `readOrUnreadable` (unreadable-read.ts) `catchTag`s exactly this, never any other mint
 * failure, which stays a hard error precisely because it is NOT a scoped refusal.
 *
 * ⛔ WHY NOT EVERY NON-2xx: A 503 (sealed) or a 404 (misconfigured mount/role) is the estate
 *   BROKEN, not this identity being narrowly scoped — folding those into "unreadable, report
 *   noop" would hide a real outage behind a quiet, misleadingly reassuring plan. Only 403 is
 *   "this identity, this role, denied" and safe to read as "cannot see, not evidence of absence".
 *
 * ⛔ NO `role` FIELD (removed, K-T1 second red-team pass). `mint.ts` knows the semantic `PveRole`
 *   it was asked for, but `lease-cache.ts`'s synthetic `mintForKey` reconstruction (after M3
 *   dropped `role` from `LeaseKey`) cannot supply the ORIGINAL caller's role on a cache-path
 *   mint — only the tier. A `role` field would then read as `'read'` on every pve cache miss
 *   regardless of which role was actually denied, which is exactly the stale/misleading-field
 *   trap M6 existed to close, one layer down. `tier` alone is what the message reads and what
 *   `readOrUnreadable`'s callers act on; nothing needs the semantic role name.
 */
export class PveCredentialDenied extends Data.TaggedError('PveCredentialDenied')<{
  readonly mount: string;
  /**
   * The OpenBao mint TIER actually requested (`credentials.ts`'s `mintTier`). ⛔ THE MESSAGE
   *   READS THIS, NOT A SEMANTIC ROLE NAME: printing `'read'` for a denied `talos-provision`
   *   mint would spell it as `creds/read`, exactly the path that was never called — silently
   *   wrong at precisely the moment an operator is reading this string to decide whether a
   *   grant, a policy or a target config is wrong (K-T1's own PR discussion).
   */
  readonly tier: string;
  readonly detail: string;
}> {
  override get message(): string {
    return (
      `OpenBao GET /v1/${this.mount}/creds/${this.tier} -> 403: ${this.detail}. This identity's ` +
      'AppRole has no grant for this role -- a refused read, not evidence the object is gone.'
    );
  }
}
