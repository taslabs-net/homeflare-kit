/**
 * `read` with no attributes — the plan-time half of "nothing is adopted without `--adopt`"
 * (adopt.ts has the apply-time half). Alchemy asks it in two situations and passes `output:
 * undefined` in both (alchemy beta.79 Plan.ts):
 *   · THE ADOPTION PROBE — no state row at all; `olds` is the declaration, `instanceId` fresh.
 *   · THE RECOVERY READ — a `creating` row whose create was interrupted after its write and before
 *     its commit; `olds` is that row's props, `instanceId` the row's. (Apply.ts asks the same for a
 *     row it must delete that never recorded attributes.)
 * The answer routes the plan: `undefined` → create; plain attributes → ours; `Unowned(…)` → the
 * plan fails with OwnedBySomeoneElse unless `--adopt` / `adopt(true)` (AdoptPolicy.ts).
 *
 * ⛔ THE PROBE ALWAYS ANSWERS `Unowned` FOR A LIVE OBJECT, EVEN ONE IDENTICAL TO THE DECLARATION
 *   (decided 2026-09-21). Identical is not ours: a name another stack, a person or an old script put
 *   there reads the same, and once state claims it, a delete under `destroy` removes it from its
 *   real owner. 🔴 Measured before the change (openbao/rename-adoption.test.ts): a new logical id
 *   for a live Bao name adopted it silently, and the old id's delete then removed it, green.
 * ★ THE RECOVERY READ STILL ADOPTS WHAT THE INTERRUPTED CREATE MADE — the instance is ours by the
 *   state row, and the object is proven ours when it matches that row's props (`settled`). One that
 *   does not match may have lost a race to someone else: `Unowned`, as Plan.ts itself asks.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import type { Owner } from './adopt.ts';
import { recordedInstance } from './rows.ts';

/**
 * A family's `read` answer. With attributes in state it is `found` as is. Without, it is the probe
 * or the recovery read (header): `found` is ours only when the state store records this instance
 * AND `settled` — the family's own "live matches these props" — says so.
 * ⛔ `settled` NEVER FAILS THE READ. The recovery read runs with the INTERRUPTED deploy's props, so
 *   a declaration that cannot be evaluated any more (a fragments directory since moved, a group
 *   name since renamed) would fail every later plan, the fix included. It reads as "not proven
 *   ours" instead — `Unowned`, which `--adopt` resolves — with the reason logged.
 */
export const ownedRead = <A extends object, E, R>(
  ask: Owner,
  found: A | undefined,
  settled: Effect.Effect<boolean, E, R>,
): Effect.Effect<A | undefined, never, R> =>
  Effect.gen(function* () {
    if (found === undefined || ask.output !== undefined) return found;
    if (!(yield* recordedInstance(ask.fqn, ask.instanceId))) return Unowned(found);
    const unproven = (reason: unknown) =>
      Effect.as(
        Effect.logWarning(
          `${ask.fqn}: the interrupted create's object could not be compared with its props ` +
            `(${reason instanceof Error ? reason.message : String(reason)}), so it is not treated as ours`,
        ),
        false,
      );
    const ours = yield* settled.pipe(Effect.catch(unproven), Effect.catchDefect(unproven));
    return ours ? found : Unowned(found);
  });
