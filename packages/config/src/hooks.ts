/**
 * The HomeFlare git hooks, as a package.
 *
 * ★ WHY THIS IS NOT A SCRIPT IN EVERY REPO. Fourteen copies of a hook script is the
 *   exact drift `@homeflare/config` exists to prevent: the copies diverge, nobody
 *   notices, and two repos disagree about what a commit must satisfy. Here the repo
 *   commits a delegating wrapper and the behaviour ships with the package, so changing
 *   the rule is one release and a version bump rather than fourteen edits.
 * ★ TRACKED `.husky/`, RUN BY GIT THROUGH `core.hooksPath` — NOT husky's `.husky/_`. Since
 *   2026-09-23 the mechanism is the one that reaches every worktree; activate.ts has the
 *   measurement. The files keep the directory name the estate already uses.
 * ★ PRE-PUSH IS SCOPED TO THE PUSH (push-range.ts, push-plan.ts): the repository's own
 *   `check`, with `bun test` narrowed to the modules the push can reach. A non-module
 *   path runs the suite in full — Bun's `--changed` follows imports only — and the
 *   build and smoke test are left to CI. Many agents push to many repositories at
 *   once; a pre-push that re-ran every suite was the one people learned to skip.
 *
 * Usage from a hook file — see `HUSKY_HOOK`:
 *
 *     bun node_modules/@homeflare/config/bin/hooks.ts pre-commit
 */
import { activateHooks } from './hooks/activate.ts';
import { preCommit, prePush } from './hooks/gates.ts';
import {
  HOOK_NAMES,
  HUSKY_HOOK,
  PREPARE,
  installHooks,
  problemsInHooks,
  wrapperDrift,
} from './hooks/install.ts';
import { type Lane, planLanes } from './hooks/push-plan.ts';
import { type Hook, fail, note, ok } from './hooks/report.ts';

export { HOOK_NAMES, HUSKY_HOOK, PREPARE, activateHooks, installHooks, planLanes, problemsInHooks };
export type { Hook, Lane };

/** The commands `bin/hooks.ts` accepts. */
export type Command = Hook | 'install' | 'activate';

export function isCommand(value: string): value is Command {
  return ['pre-commit', 'pre-push', 'install', 'activate'].includes(value);
}

/**
 * Run one hook, write the wrappers, or activate them.
 *
 * `args` are git's own hook arguments (for `pre-push`: the remote name and URL) and
 * `stdin` is what git wrote to the hook (for `pre-push`: the refs being pushed).
 * ⛔ Never exits non-zero for a reason the caller cannot act on: an unknown command is a
 *   programming error in the wrapper and is reported as such, not as a failed commit.
 */
export async function runCommand(
  command: Command,
  root: string,
  args: readonly string[] = [],
  stdin = '',
): Promise<void> {
  if (command === 'install') {
    const written = await installHooks(root);
    ok(`wrote ${written.join(', ')} — commit them`);
    note(`then set "prepare": "${PREPARE}" so every install activates them`);
    return;
  }
  if (command === 'activate') {
    const result = await activateHooks(root);
    (result.active ? ok : note)(`homeflare hooks: ${result.message}`);
    return;
  }
  // ⛔ A STALE WRAPPER STOPS THE HOOK — see `wrapperDrift`: the bumper never refreshes `.husky/`,
  //   so this is the only place a consumer finds out its committed copy is out of date.
  const drift = await wrapperDrift(root, command);
  if (drift !== undefined) fail(command, drift.what, drift.fix);
  if (command === 'pre-commit') return await preCommit(root);
  return await prePush(root, args, stdin);
}
