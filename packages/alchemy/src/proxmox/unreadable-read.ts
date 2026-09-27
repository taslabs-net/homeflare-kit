/**
 * The "unreadable" outcome a refused read produces — distinct from `undefined` (genuinely
 * absent) and from a real attributes object (present) — so `diff` stops treating a REFUSED read
 * the same as a confirmed-gone one. Fixes the "cries wolf" bug (measured 2026-09-24): on a lane
 * whose credential cannot mint `provision`, every already-correct ACL and storage row read back
 * as absent, and `diff` forced `update` for every one of them without comparing a single field,
 * because `.pipe(Effect.orElseSucceed(() => undefined))` folds every failure — a genuine 404, a
 * network blip, AND a permission refusal — into the one "absent" value `diff` cannot tell apart.
 *
 * ★ WHY A SENTINEL, NOT A FAILED `diff`. Upstream's `Diff` type is exactly
 *   `NoopDiff | UpdateDiff | ReplaceDiff` (`packages/alchemy/src/Diff.ts@v2.0.0-beta.79`) — there
 *   is no fourth "unreadable" action to return. And `Plan.ts`'s resource pass runs every
 *   resource's `diff` under `Effect.exit`, then FAILS THE WHOLE PLAN if even one failed
 *   (`diffFailures.length > 0` -> `Effect.failCause`, `Plan.ts@v2.0.0-beta.79` ~lines 1711-1731).
 *   So making `diff` FAIL on a refused read would not report one honest row — it would abort
 *   `bun run plan` for every OTHER resource in the stack too, worse than today's false "update".
 *   `{ action: 'noop' }` plus a logged warning is the only outcome that (a) never forces a write
 *   on a lane that cannot prove one is needed and (b) never takes the rest of the plan down with
 *   it — the "noop-with-warning" reading of the fix, over the alternative of a typed plan error.
 *
 * ⛔ ONLY THE CREDENTIAL DENIAL IS CAUGHT HERE. Other errors propagate to the caller.
 *   Legacy callers may still fold them, but the typed-absence follow-up makes User/Group/
 *   Storage catch only their SDK missing-object tag. Never infer a resource is absent from
 *   this sentinel. See credential-errors.ts's own ⛔ for why the OpenBao mint's 403 qualifies.
 */
import * as Effect from 'effect/Effect';
import type { PveCredentialDenied } from './credential-errors.ts';

/** Distinct from `undefined` (absent) and from a real attributes object (present). */
export const UNREADABLE = Symbol('pve-unreadable');
export type Unreadable = typeof UNREADABLE;

/**
 * Catches ONLY `PveCredentialDenied` and returns the sentinel. Compose this BEFORE the
 * caller's absence handling so a credential refusal cannot become a genuine absence.
 * This helper itself classifies neither SDK missing-object tags nor transport failures.
 *
 * ⚠️ `E | PveCredentialDenied` IN, `E` OUT — not a generic `E` narrowed by `Exclude`. `catchTag`
 *   needs the tag to be STATICALLY present in the error union to typecheck at all; a bare
 *   unconstrained `E` gives it nothing to match against. Every caller's `runPve` already carries
 *   `PveCredentialDenied` explicitly (distilled-pve.ts's own ★ on why), so this signature costs
 *   nothing at the call site.
 */
export const readOrUnreadable = <A, E, R>(
  effect: Effect.Effect<A, E | PveCredentialDenied, R>,
): Effect.Effect<A | Unreadable, E, R> =>
  effect.pipe(Effect.catchTag('PveCredentialDenied', () => Effect.succeed(UNREADABLE)));

/**
 * The warning `diff` logs when it reports `noop` for a row it could not actually read — visible
 * in `bun run plan`'s own output (Effect's default logger), even though the Diff type has
 * nowhere to carry the distinction through to the printed action. See the header for why a log
 * line, not a failed diff or a fourth Diff action, is what "the plan reports" means here.
 */
export const unreadableWarning = (type: string, identity: string): Effect.Effect<void> =>
  Effect.logWarning(
    `${type} ${identity}: the read was refused (no grant for this credential's role) -- ` +
      'reporting noop rather than forcing an update with nothing compared. Re-plan on a lane ' +
      'that can read this object before trusting this row.',
  );
