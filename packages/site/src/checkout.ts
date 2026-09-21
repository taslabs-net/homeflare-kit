/**
 * Is the site file committed, unmodified, on `main`?
 *
 * ⛔ NODE-ONLY (spawns git). Imported by `@homeflare/site/load`, never by the main entry.
 *
 * ★ WHY THE LOADER ASKS. Live plans must run on reviewed values. A site file edited in a
 *   working tree, or read from a feature branch, would plan whatever it says — and a plan
 *   against live state is where an unreviewed rename becomes a replace. `siteDev` (the
 *   `--site-dev` flag in a consumer's CLI) is the explicit, visible way around it.
 *
 * ★ DIRTINESS IS THE FILE'S OWN, not the whole checkout's. Unrelated uncommitted work in
 *   the repo holding the site file says nothing about the values being loaded, and would
 *   otherwise block every deploy while someone edits a doc.
 */
import { execFile } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * ⚠️ GIT_* FROM THE CALLER'S ENVIRONMENT IS DROPPED. Git exports `GIT_DIR` (and friends)
 *   to hooks, and `-C <dir>` does not override an exported `GIT_DIR`. Measured 2026-09-21:
 *   `GIT_DIR=<some repo>/.git git -C <a directory outside any repo> symbolic-ref HEAD`
 *   printed that other repo's branch. A loader run from a pre-push hook would ask about
 *   the HOOK's repository, and answer "clean, on main" for a file it never looked at.
 */
function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
}

export interface CheckoutState {
  /** The checked-out branch, or `undefined` on a detached HEAD. */
  readonly branch: string | undefined;
  /** Git knows the file (⚠️ an ignored or untracked file was never reviewed). */
  readonly tracked: boolean;
  /** The file differs from HEAD, staged or not. */
  readonly dirty: boolean;
}

async function git(dir: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv() });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** The file's checkout state, or `undefined` when it is not inside a git work tree. */
export async function readCheckout(file: string): Promise<CheckoutState | undefined> {
  const dir = dirname(file);
  const name = basename(file);
  if ((await git(dir, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return undefined;
  // ★ symbolic-ref, not `rev-parse --abbrev-ref`: it answers on an unborn branch too, and
  //   fails (→ undefined) on a detached HEAD instead of printing the word "HEAD".
  const branch = await git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const tracked = (await git(dir, ['ls-files', '--error-unmatch', '--', name])) !== undefined;
  const status = await git(dir, ['status', '--porcelain', '--', name]);
  return { branch, tracked, dirty: status === undefined || status !== '' };
}

/** Why `state` is not a reviewed checkout of `branch`, or `undefined` when it is. */
export function checkoutProblem(
  state: CheckoutState | undefined,
  branch: string,
): string | undefined {
  if (state === undefined) return 'it is not inside a git checkout';
  if (!state.tracked) return 'it is not committed (untracked or ignored)';
  if (state.dirty) return 'it has uncommitted changes';
  if (state.branch !== branch) {
    return `the checkout is on ${state.branch === undefined ? 'a detached HEAD' : `"${state.branch}"`}, not "${branch}"`;
  }
  return undefined;
}
