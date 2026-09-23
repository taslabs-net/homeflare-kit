/**
 * The pins as the STACK PROGRAM declared them — before the engine resolved a single Output — checked
 * at apply. The half of "a pin is never computed during the deploy" that a FIRST deploy needs.
 *
 * ⛔ WHY APPLY HAS TO ASK THE STACK, NOT `news`. By the time `reconcile` runs, the engine has
 *   resolved every Output in `news`, so a digest wired from another resource (a checksum file read
 *   at apply, a lookup, a computed value) arrives as a well-formed plain string, indistinguishable
 *   from a reviewed pin. And on a first deploy nothing else looked: Alchemy never diffs a create,
 *   and skips the adoption probe while `news` holds an Output (beta.79 Plan.ts). 🔴 MEASURED
 *   2026-09-22 (apply-pins.test.ts): a swapped archive plus the swapped digests, wired in as an
 *   Output, installed the swapped bytes and the deploy reported success. binary-diff.ts refused the
 *   same declaration only from the SECOND plan on, after the wrong binary was on the host.
 * ★ `Stack.resources[fqn].Props` IS WHAT THE PROGRAM PASSED, Outputs and all: Alchemy's
 *   `Resource` records it at registration (beta.79 Resource.ts, `Props: props`), and the same Stack
 *   reaches the apply (ownership/adopt.ts reads `Adopt` from the same record for the same reason).
 *   pinProblems then sees the Output itself — a function-typed proxy, an Effect or a Config — and
 *   refuses it as "not a plain string".
 * ⚠️ NO STACK, NO ANSWER. A handler called outside the engine (the fake-provider.ts harness) has no
 *   Stack service and no registration to read, so this says nothing there; the engine always has
 *   one. apply-pins.test.ts runs the real Plan and Apply, so an Alchemy upgrade that stops
 *   recording `Props` there makes the swapped bytes install again, and fails that test by name.
 */
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import { pinProblems } from './binary-form.ts';

/** Everything wrong with the pins of the resource at `fqn` as its stack program declared them. */
export const declaredPinProblems = (fqn: string): Effect.Effect<string[]> =>
  Effect.gen(function* () {
    const stack = yield* Effect.serviceOption(Stack);
    if (Option.isNone(stack)) return [];
    const declared: unknown = stack.value.resources[fqn]?.Props;
    if (typeof declared !== 'object' && typeof declared !== 'function') return [];
    if (declared === null) return [];
    return pinProblems(declared as Parameters<typeof pinProblems>[0]).map(
      (problem) => `as declared in the stack program, ${problem}`,
    );
  });
