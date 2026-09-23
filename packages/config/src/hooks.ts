/**
 * The HomeFlare git hooks, as a package.
 *
 * ★ WHY THIS IS NOT A SCRIPT IN EVERY REPO. Fourteen copies of a hook script is the
 *   exact drift `@homeflare/config` exists to prevent: the copies diverge, nobody
 *   notices, and two repos disagree about what a commit must satisfy. Here the repo
 *   commits a delegating wrapper and the behaviour ships with the package, so changing
 *   the rule is one release and a version bump rather than fourteen edits.
 *
 * ⚠️ HUSKY, NOT lefthook OR A BARE `core.hooksPath`. It is already the estate's
 *   mechanism in the repos that have working hooks, it installs from `prepare` on a
 *   plain `bun install`, and it keeps the hook files tracked and reviewable. A second
 *   mechanism alongside it would mean two ways to answer "are hooks on in this repo".
 *
 * Usage from a hook file — see `HUSKY_HOOK`:
 *
 *     bun node_modules/@homeflare/config/bin/hooks.ts pre-commit
 */
import { preCommit, prePush } from './hooks/gates.ts';
import { HOOK_NAMES, HUSKY_HOOK, installHooks, problemsInHooks } from './hooks/install.ts';
import { type Hook, note, ok } from './hooks/report.ts';

export { HOOK_NAMES, HUSKY_HOOK, installHooks, problemsInHooks };
export type { Hook };

/** The commands `bin/hooks.ts` accepts. */
export type Command = Hook | 'install';

export function isCommand(value: string): value is Command {
  return value === 'pre-commit' || value === 'pre-push' || value === 'install';
}

/**
 * Run one hook, or install the wrappers.
 *
 * ⛔ Never exits non-zero for a reason the caller cannot act on: an unknown command is a
 *   programming error in the wrapper and is reported as such, not as a failed commit.
 */
export async function runCommand(command: Command, root: string): Promise<void> {
  if (command === 'install') {
    const written = await installHooks(root);
    ok(`wrote ${written.join(', ')} — commit them`);
    note('they do nothing until `bun install` runs `prepare` (husky)');
    return;
  }
  if (command === 'pre-commit') return await preCommit(root);
  return await prePush(root);
}
