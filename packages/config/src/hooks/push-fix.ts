/**
 * What to tell someone whose push the working tree cannot vouch for.
 *
 * ★ THE FIX IS ALWAYS A CHECKOUT. The pre-push lanes run on the working tree, so a ref can be
 *   checked only by being the checkout (push-range.ts); the message names each ref to check
 *   out and push on its own, and in a mixed push the ref that already IS the checkout, which
 *   goes first. A failure that said only "cannot check this" would leave the contributor to
 *   work out which refs, in what order.
 */

/** `refs/heads/feat` reads as `feat`; a tag or any other ref keeps its full name. */
const named = (ref: string): string => ref.replace(/^refs\/heads\//, '');

/**
 * `refs` are the pushed refs that are not the checkout; `here` are the ones that are,
 * non-empty only in a mixed push.
 */
export function checkoutFix(refs: readonly string[], here: readonly string[]): string {
  const names = refs.map(named);
  const there =
    names.length === 1
      ? `check out ${names[0] ?? 'the ref'} and push from there`
      : `check out each of ${names.join(', ')} and push it from there, one at a time`;
  return here.length === 0 ? there : `push ${alone(here.map(named))}, then ${there}`;
}

/**
 * ⚠️ `main on its own`, but `main and refs/tags/v1 on their own`: several refs can be the
 * checkout at once (`--mirror` and `--all` push whatever points at it), and "on its own"
 * after a comma list read as a slip.
 */
function alone(names: readonly string[]): string {
  if (names.length === 1) return `${names[0] ?? 'the ref'} on its own`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''} on their own`;
}
