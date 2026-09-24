/**
 * `credentials.ts`'s one typed mint failure (S21) — split out to keep that file under the
 * 250-line cap once this class grew a real header (2026-09-24, the cries-wolf fix).
 */
import * as Data from 'effect/Data';
import type { PveRole } from './credentials.ts';

/**
 * OpenBao answered 403 to `GET /v1/<mount>/creds/<role>`: this identity's AppRole has no grant
 * for `role` on `mount` — measured 2026-09-24 as "the agent lane cannot mint `provision`" (the
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
 */
export class PveCredentialDenied extends Data.TaggedError('PveCredentialDenied')<{
  readonly mount: string;
  readonly role: PveRole;
  readonly detail: string;
}> {
  override get message(): string {
    return (
      `OpenBao GET /v1/${this.mount}/creds/${this.role} -> 403: ${this.detail}. This identity's ` +
      'AppRole has no grant for this role -- a refused read, not evidence the object is gone.'
    );
  }
}
