/**
 * The one refusal every `Unifi.*` write handler returns — never an SDK write call.
 *
 * ⛔ TIM'S RULE, 2026-09-24: UniFi (and OPNsense) are READ-ONLY FOR NOW. This family has no
 *   `create`, no `update` body and no delete call anywhere in its source — `reconcile` and
 *   `delete` both fail with this typed error instead, and `resource.test.ts` proves the point
 *   with a fake `HttpClient` that fails the test on any request that is not a `GET`. Lifting the
 *   policy is a kit change (a new PR that adds a write path, reviewed as one), not a flag a stack
 *   can pass.
 *
 * ★ A TYPED TAG, NOT A THROWN STRING (S21). `Effect.catchTag('UnifiWriteRefused', …)` lets a
 *   caller (a future import script, a test) branch on the refusal without parsing a message.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';

export const UNIFI_READ_ONLY_POLICY =
  "read-only by Tim's rule, 2026-09-24; lifting it is a kit change";

/** What kind of write was asked for and refused — for the message only, never acted on. */
export type UnifiWriteAction = 'create' | 'update' | 'delete';

export class UnifiWriteRefused extends Data.TaggedError('UnifiWriteRefused')<{
  /** The vendor type string, e.g. `Unifi.Network`. */
  readonly type: string;
  /** `spec.describe(props)` — the object the write would have touched. */
  readonly identity: string;
  readonly action: UnifiWriteAction;
}> {
  override get message(): string {
    return `${this.type} ${this.identity}: refusing to ${this.action} -- ${UNIFI_READ_ONLY_POLICY}.`;
  }
}

/** The only thing `reconcile`/`delete` ever return for a write this family cannot make. */
export const refuseWrite = (type: string, identity: string, action: UnifiWriteAction) =>
  Effect.fail(new UnifiWriteRefused({ type, identity, action }));
