/**
 * The strict adoption gate for `Proxmox.Lxc`: AN ADOPTION NEVER CHANGES A GUEST (decided
 * 2026-09-21). A guest this stack adopts — no recorded instance, or one the plan only kept because
 * `--adopt` said so (ownership/adopting.ts) — is taken over exactly as it runs, or not at all.
 *
 * ⛔ ANY DIFFERENCE FAILS, AT PLAN AND AGAIN AT APPLY. Before this, a cold adoption planned `adopted`
 *   whatever it would write (alchemy beta.79 prints no property diff for it) and only LOGGED the
 *   keys; `deploy --adopt --yes` then wrote them. A `net0` pasted without the live `tag=` moved the
 *   guest off its VLAN on the deploy that was meant to change nothing. Now the plan fails naming
 *   the keys, and reconcile re-asks against a fresh read, so a hand edit between plan and deploy
 *   is refused too rather than written back.
 * ⛔ KEYS ONLY, NEVER VALUES. The refusal names what differs and nothing it differs by: a live
 *   config can carry anything (`description` is where people paste credentials), and plan output
 *   lands in CI logs.
 * ★ ASKED BEFORE `judge`'s OWN REFUSALS. Those name a declared value (the `pct set` to run), and
 *   for an adoption the fix is the other direction: declare what is live.
 * ★ THE STORE IS READ ONLY WHEN SOMETHING DIFFERS. A clean adoption — the only kind that proceeds
 *   — costs nothing here.
 */
import * as Effect from 'effect/Effect';
import type { Owner } from '../ownership/adopt.ts';
import { adopting } from '../ownership/adopting.ts';
import { type LxcChange, judge } from './lxc-judge.ts';
import { LxcRefusedError } from './lxc-lifecycle.ts';
import type { LxcProps } from './lxc-props.ts';

/** The refusal: keys, where, and what to do — never a value. */
export const adoptionRefusal = (props: LxcProps, drift: readonly string[]): string =>
  `CT ${String(props.vmid)} on ${props.node}: adopting it would change ${drift.join(', ')}. An ` +
  'adoption never changes a guest, so nothing is written. Declare what is live for these keys ' +
  '(the plan names keys, never values) and plan again; change them after the adoption, as an ' +
  'update.';

/**
 * Fails with `adoptionRefusal` when `change` would write to a guest `owner`'s call adopts.
 * `settled` for a recovered create is the same judge, of the recording row's props against `live`.
 */
export const refuseAdoptedDrift = (
  owner: Owner,
  props: LxcProps,
  live: Record<string, unknown>,
  change: LxcChange,
): Effect.Effect<void, LxcRefusedError> =>
  Effect.gen(function* () {
    if (change.drift.length === 0) return;
    const settled = (recorded: unknown) =>
      Effect.sync(() => judge(recorded as LxcProps, live).drift.length === 0);
    if (!(yield* adopting(owner, settled))) return;
    return yield* Effect.fail(new LxcRefusedError(adoptionRefusal(props, change.drift)));
  });
