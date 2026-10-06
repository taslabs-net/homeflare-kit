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
 * ⛔ ONLY WHEN THE ROW'S PROPS ARE THE WHOLE DECLARATION (whole.ts). A row written while a prop was
 *   still an Output has a hole there, and "matches" against a hole proves nothing — nor had that
 *   deploy's plan ever asked whose object it was, because Alchemy skips the probe for an Output.
 *   Such a create resumes with `--adopt`.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import type { Owner } from './adopt.ts';
import { resumes } from './resume.ts';
import { forgetRefusedCreate, recordedInstance } from './rows.ts';

/**
 * Whether this read is APPLY's own (Apply.ts `instrumentLifecycle` wraps every apply-time lifecycle
 * call in a `provider.read` span; the plan's reads run outside one).
 * ⛔ AN APPLY-TIME READ WITH NO ATTRIBUTES PROVES NOTHING. 🔴 MEASURED 2026-10-06 (alchemy
 *   2.0.0-beta.81, openbao/adopt-core.test.ts and nine more suites): beta.81 asks the provider to
 *   read at APPLY for a create whose props were still Outputs at plan (Plan.ts `deferredAdoption`),
 *   and first overwrites the `creating` row with the NOW-RESOLVED props (Apply.ts `checkpoint`). That
 *   row is whole, so `provenOurs` read the live object as matching it, and another owner's object
 *   was taken over with no `--adopt`. Answering `Unowned` here hands the decision back to the engine,
 *   which refuses it ("Cannot adopt resource … Re-run with `--adopt`") unless adoption is on.
 * ★ THE ONE PROOF AN APPLY-TIME READ MAY USE IS THE PLAN'S: the diff's own recovery read noted this
 *   instance as a proven resume (resume.ts), and that note is what `resumes` answers.
 */
const readsAtApply: Effect.Effect<boolean> = Effect.map(
  Effect.option(Effect.currentSpan),
  (span) => Option.isSome(span) && span.value.name === 'provider.read',
);

/**
 * Whether the state store proves the live object this instance's own: a row records `ask.instanceId`
 * with its whole declaration (whole.ts) AND `settled` — the family's own "live matches these props"
 * — says so. The one proof ownership/ accepts for a live object state holds no attributes for; the
 * recovery read (`ownedRead`) and an adoption check (adopting.ts) both ask it.
 * ⛔ `settled` NEVER FAILS THE CALLER. The recovery read runs with the INTERRUPTED deploy's props, so
 *   a declaration that cannot be evaluated any more (a fragments directory since moved, a group
 *   name since renamed) would fail every later plan, the fix included. It reads as "not proven
 *   ours" instead, with the reason logged.
 */
export const provenOurs = <E, R>(
  ask: { readonly fqn: string; readonly instanceId: string },
  settled: Effect.Effect<boolean, E, R>,
): Effect.Effect<boolean, never, R> =>
  Effect.gen(function* () {
    if (yield* readsAtApply) return yield* resumes(ask.instanceId);
    const recorded = yield* recordedInstance(ask.fqn, ask.instanceId);
    if (recorded === 'absent') return false;
    if (recorded === 'partial') {
      yield* Effect.logWarning(
        `${ask.fqn}: the interrupted create's state row lacks part of the declaration (a prop ` +
          'was still an Output when it was written), so the live object is not proven ours',
      );
      return false;
    }
    const unproven = (reason: unknown) =>
      Effect.as(
        Effect.logWarning(
          `${ask.fqn}: the interrupted create's object could not be compared with its props ` +
            `(${reason instanceof Error ? reason.message : String(reason)}), so it is not treated as ours`,
        ),
        false,
      );
    return yield* settled.pipe(Effect.catch(unproven), Effect.catchDefect(unproven));
  });

/**
 * A family's `read` answer. With attributes in state it is `found` as is. Without, it is the probe
 * or the recovery read (header): `found` is ours only when `provenOurs` says so, else `Unowned`,
 * which `--adopt` resolves.
 */
export const ownedRead = <A extends object, E, R>(
  ask: Owner,
  found: A | undefined,
  settled: Effect.Effect<boolean, E, R>,
): Effect.Effect<A | undefined, never, R> =>
  Effect.gen(function* () {
    if (found === undefined || ask.output !== undefined) return found;
    if (yield* provenOurs(ask, settled)) return found;
    // ⛔ THE ENGINE'S OWN REFUSAL LEAVES ITS `creating` CHECKPOINT BEHIND (Apply.ts), now holding the
    //   RESOLVED props: a whole row, which the next plan's recovery read would take as proof and
    //   adopt exactly what was refused. Forgotten here, as adopt.ts refuseTakeover does for its own
    //   refusal; under --adopt the engine's later `created` commit writes the row again.
    if (yield* readsAtApply) yield* forgetRefusedCreate(ask.fqn, ask.instanceId);
    return Unowned(found);
  });
