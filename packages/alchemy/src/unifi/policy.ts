/**
 * The one refusal every `Unifi.*` write handler returns — never an SDK write call.
 *
 * ⛔ TIM'S RULE, 2026-09-24: UniFi (and OPNsense) are READ-ONLY. LIFTED FOR EXACTLY ONE CASE on
 *   2026-10-10 (Tim): `Unifi.Network` update, through `update-reconcile.ts` + `network-update.ts`.
 *   Every other write — create, delete, any other family's update — still fails with this typed
 *   error, and `resource.test.ts`/`wire-guard.test.ts` prove it with a fake `HttpClient` that
 *   records every request. Widening the policy again is a kit change (a new PR, reviewed as one),
 *   not a flag a stack can pass.
 *
 * ★ A TYPED TAG, NOT A THROWN STRING (S21). `Effect.catchTag('UnifiWriteRefused', …)` lets a
 *   caller (a future import script, a test) branch on the refusal without parsing a message.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';

export const UNIFI_WRITE_POLICY =
  'UniFi is adopt-only except Unifi.Network update: one whole-object PUT built from the live ' +
  'object plus the declared field changes, only on a row with prior Alchemy state, only through ' +
  'deploy-approve; create/delete and every other family stay refused -- widening is a kit change ' +
  '(Tim 2026-10-10 lifts the 2026-09-24 rule for this one case)';

/** @deprecated renamed `UNIFI_WRITE_POLICY`; kept so existing consumer imports do not break. */
export const UNIFI_READ_ONLY_POLICY = UNIFI_WRITE_POLICY;

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
    return `${this.type} ${this.identity}: refusing to ${this.action} -- ${UNIFI_WRITE_POLICY}.`;
  }
}

/** The only thing `reconcile`/`delete` ever return for a write this family cannot make. */
export const refuseWrite = (type: string, identity: string, action: UnifiWriteAction) =>
  Effect.fail(new UnifiWriteRefused({ type, identity, action }));

// ⛔ THE THREE ERRORS BELOW CARRY FIELD NAMES ONLY, NEVER VALUES: a network row holds addressing
//   detail, and an error message reaches logs, CI bodies and pasted reports.
const fieldList = (fields: ReadonlyArray<string>) => `[${fields.join(', ')}]`;

/** Live no longer equals what the last deploy wrote: a hand edit is never overwritten. */
export class UnifiLiveDriftedSinceDeploy extends Data.TaggedError('UnifiLiveDriftedSinceDeploy')<{
  readonly type: string;
  readonly identity: string;
  readonly fields: ReadonlyArray<string>;
}> {
  override get message(): string {
    return (
      `${this.type} ${this.identity}: live differs from the last deployed state on ` +
      `${fieldList(this.fields)}; refusing to PUT over a hand edit. Re-import first.`
    );
  }
}

/** The merged body equals live: a PUT would change nothing (keeps a re-PUT loop impossible). */
export class UnifiUpdateWouldBeNoop extends Data.TaggedError('UnifiUpdateWouldBeNoop')<{
  readonly type: string;
  readonly identity: string;
}> {
  override get message(): string {
    return `${this.type} ${this.identity}: the merged update body equals live; refusing a no-op PUT.`;
  }
}

/** The PUT answered, yet the response still differs from the declaration. */
export class UnifiUpdateDidNotConverge extends Data.TaggedError('UnifiUpdateDidNotConverge')<{
  readonly type: string;
  readonly identity: string;
  readonly fields: ReadonlyArray<string>;
}> {
  override get message(): string {
    return `${this.type} ${this.identity}: PUT answered but ${fieldList(this.fields)} still differ from the declaration.`;
  }
}
