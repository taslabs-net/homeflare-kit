/**
 * `OpnsenseWriteRefused` — the one error every resource in this family can raise for a write,
 * and the only thing standing between "read-only for now" and an actual change against the edge.
 *
 * ⛔ TIM, 2026-09-24: UniFi AND OPNSENSE ARE READ-ONLY FOR NOW. `Opnsense.Firewall.Alias`,
 *   `.Category` and `.Group` (alias.ts, category.ts, group.ts) exist to `read`, `diff` and adopt
 *   against the live edge — never to change it. This is the estate's EDGE firewall: a failed
 *   probe gets the caller's IP CrowdSec-banned (`edge-crowdsec-bans-lan-ssh-probes` in the shared
 *   estate memory), and nothing about that risk is worth a resource that can also reconfigure it.
 *   Every `reconcile` and `delete` in this directory calls `refuseWrite` below and NOTHING ELSE —
 *   none of them imports an `add`/`set`/`del`/`toggle` operation from `@distilled.cloud/opnsense`
 *   at all, and `write-refusal.test.ts` proves it with a fake HTTP client that fails the test on
 *   any request that is not a GET.
 *
 * ★ LIFTING THIS IS A KIT CHANGE, NEVER A PROP. There is no `allowWrite` flag on any resource
 *   here — a flag is one bad `true` (or one bad default) away from a live edit to the box that
 *   fronts the whole estate. Lifting the policy means editing this file, and writing the
 *   create/update/delete bodies these resources do not have, a decision Tim makes explicitly by
 *   changing code and review, not a runtime toggle a stack can set.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';

export type OpnsenseWriteAction = 'create' | 'update' | 'delete';

export class OpnsenseWriteRefused extends Data.TaggedError('OpnsenseWriteRefused')<{
  readonly resourceType: string;
  readonly id: string;
  readonly action: OpnsenseWriteAction;
}> {
  override get message(): string {
    return (
      `${this.resourceType} ${this.id}: refusing to ${this.action} — read-only by Tim's rule, ` +
      '2026-09-24; lifting it is a kit change, not a prop.'
    );
  }
}

/**
 * Every `reconcile`/`delete` handler in this family funnels through this one call — see
 * `resource.ts`'s `opnsenseOperations`. Nothing downstream of this function can reach a write:
 * it never calls an SDK operation, it only builds and fails with the typed refusal above.
 */
export const refuseWrite = (
  resourceType: string,
  id: string,
  action: OpnsenseWriteAction,
): Effect.Effect<never, OpnsenseWriteRefused> =>
  Effect.fail(new OpnsenseWriteRefused({ action, id, resourceType }));
