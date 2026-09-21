/**
 * Whether a state row's props say everything the declaration says — the test that separates a row
 * whose props can prove an object ours from one that cannot (probe.ts, rows.ts).
 *
 * ★ WHY A ROW CAN BE MISSING PART OF ITS DECLARATION. Apply commits the `creating` (or `replacing`)
 *   row BEFORE reconcile runs, and strips every prop still an Output at that moment (alchemy
 *   beta.79 Apply.ts `commit` → Diff.ts `stripUnresolved`); a JSON store then drops the key. So a
 *   row written while an upstream was still being created carries a HOLE where that prop was.
 * ⛔ A HOLE IS "UNKNOWN", NOT "UNMANAGED". Most families read an absent prop as "not managed", so a
 *   recovery read comparing the live object with holed props proves nothing: 🔴 MEASURED 2026-09-21
 *   (openbao/adopt-holes.test.ts), a Bao.Mount whose `defaultLeaseTtl` was an Output, killed before
 *   its reconcile ran, adopted — and tuned — another owner's mount on the next deploy; with the
 *   NAME an Output, every role family read an empty name, found nothing, and the resumed create
 *   wrote over another owner's role. Neither deploy had ever asked whose object it was.
 * ★ THE DECLARATION IS WHAT TELLS A HOLE FROM AN OMISSION. It still holds the Output (or the literal)
 *   the row lacks, while an optional prop left out is absent from both.
 * ⚠️ CONSERVATIVE BY DESIGN: a prop added to the declaration after the crash also reads as a hole.
 *   That costs one `--adopt`, never a takeover.
 */
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

const absent = (value: unknown): boolean => value === undefined || value === null;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Whether `recorded` carries a value everywhere `declared` does. Plain objects and arrays are
 * walked; any other declared value — a literal, an Output, an Effect — needs a value in the row.
 */
export const carries = (declared: unknown, recorded: unknown): boolean => {
  if (absent(declared)) return true;
  if (absent(recorded)) return false;
  if (Array.isArray(declared)) {
    if (!Array.isArray(recorded)) return false;
    return declared.every((each, index) => carries(each, recorded[index]));
  }
  if (isPlainObject(declared)) {
    if (!isPlainObject(recorded)) return false;
    return Object.entries(declared).every(([key, each]) => carries(each, recorded[key]));
  }
  return true;
};

/**
 * Whether `props` — one generation's, from the state store — carry the whole declaration of the
 * resource at `fqn`. ⛔ FALSE WITH NOTHING TO COMPARE: no Stack in context, or a resource no longer
 *   declared (an orphan's delete). That object then reads as `Unowned` and Apply leaves it in place
 *   with a note, rather than deleting what it cannot prove it made.
 */
export const wholeDeclaration = (fqn: string, props: unknown): Effect.Effect<boolean> =>
  Effect.map(Effect.serviceOption(Stack), (stack) => {
    const declared = Option.isSome(stack) ? stack.value.resources[fqn] : undefined;
    return declared !== undefined && carries(declared.Props, props);
  });
