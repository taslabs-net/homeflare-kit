/**
 * What must be true of the worktree before `pre-commit` or `pre-push` can mean anything.
 *
 * ⛔ BOTH FAIL, NEITHER SKIPS (Tim, 2026-10-01). A gate that cannot run is fixed, never skipped,
 *   and a gate that runs on something other than what ships is worse: it certifies it.
 */
import { existsSync } from 'node:fs';
import { type Hook, fail, probe } from './report.ts';

/** How many changed paths a failure lists before it says "and N more". */
const SHOWN = 5;

/**
 * Has `bun install` run in this worktree? Fails the hook if not.
 *
 * ⛔ WITHOUT IT, FAIL — NEVER SKIP, NEVER IMPROVISE. A fresh worktree runs its hooks
 *   (activate.ts), and in the repo that HOSTS this package they are reached by workspace
 *   path, not through node_modules. There `tool()` would fall back to `bunx`, fetching an
 *   unpinned oxfmt mid-commit, and a pre-push lane would die on "command not found". The
 *   alternative, letting the commit through unchecked, is a gate that quietly is not one.
 *   The wrapper every other repo commits makes the same call one step earlier (install.ts).
 * ⚠️ IT LOOKS AT THE REPOSITORY ROOT, because git runs a hook there. A package that lives in
 *   a subdirectory with its own `node_modules` would fail this with a fix that cannot work;
 *   no estate repository has that layout (docs/hooks.md says so).
 */
export function requireInstalled(root: string, hook: Hook): void {
  if (existsSync(`${root}/node_modules`)) return;
  fail(
    hook,
    'no node_modules in this worktree, so the checks cannot run',
    "run 'bun install' in this worktree",
  );
}

/**
 * Is the working tree exactly what is being pushed? Fails `pre-push` if anything differs.
 *
 * 🔴 THE LANES RUN ON THE WORKING TREE, NOT ON THE COMMIT. push-range.ts asks whether the
 *   pushed ref IS `HEAD`; it never asked whether the working tree IS `HEAD`. Measured by
 *   the red team on 2026-10-01 with real pushes: a committed, test-breaking change with the
 *   old value restored UNCOMMITTED pushed with exit 0, and so did a committed file importing
 *   an untracked `w.ts` that the remote would never have. The lanes were green on a tree
 *   nobody was pushing.
 * ★ UNTRACKED FILES COUNT, AND IGNORED ONES DO NOT. `--porcelain` lists the first and omits
 *   the second, which is the line a lane can and cannot see: an ignored `node_modules` is
 *   the install, not the content.
 */
export async function requireCleanTree(root: string): Promise<void> {
  const status = await probe(
    ['git', '-C', root, '--no-optional-locks', 'status', '--porcelain'],
    true,
  );
  if (status.code !== 0) {
    fail(
      'pre-push',
      'git status failed, so the working tree could not be compared with the push',
      'run `git status` in this worktree and fix what it reports',
    );
  }
  const changes = status.stdout.split('\n').filter((line) => line.length > 0);
  if (changes.length === 0) return;
  const more = changes.length > SHOWN ? `; and ${String(changes.length - SHOWN)} more` : '';
  fail(
    'pre-push',
    `the working tree has uncommitted changes, so the lanes would check something other than what is pushed (${changes.slice(0, SHOWN).join('; ')}${more})`,
    'commit or `git stash -u`, then push',
  );
}
