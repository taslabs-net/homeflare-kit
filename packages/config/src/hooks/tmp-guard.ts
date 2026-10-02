/**
 * A test lane's temp directory, and the "/tmp" literals that never land in it.
 *
 * ★ BUN 1.4.0, READ FROM SOURCE. `os.tmpdir()` (`src/js/node/os.ts`) on POSIX is
 *   `TMPDIR`, then `TMP`, then `TEMP`, then `/tmp`. `fs.mkdtemp` / `mkdtempSync`
 *   (`src/js/node/fs.ts`) append six characters to the prefix the caller passed. They
 *   do not read `TMPDIR`. `mkdtemp(join(tmpdir(), 'enables-cfg-'))` therefore lands
 *   inside this guard; `mkdtemp('/tmp/enables-cfg-')` does not.
 * ⛔ A HARDCODED `/tmp` ESCAPES. The guard only sees children of the directory it set
 *   as `TMPDIR`. A test that writes a path starting with `/tmp` creates that directory
 *   on the host tmpfs, the lane still exits 0, and the inode leak this exists for
 *   continues. `problemsInTmpLiterals` fails those lines unless a comment on the same
 *   line or the line above says `tmp-allow:` and gives a reason.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { note, runLane } from './report.ts';

/** One leaked name prefix and how many top-level entries share it. */
export type LeakPrefix = {
  readonly prefix: string;
  readonly count: number;
};

/** What `runInTmp` observed. `removed` names the guard directory cleanup attempted. */
export type TmpRun = {
  readonly code: number;
  readonly leaks: readonly LeakPrefix[];
  readonly removed: string;
  readonly cleanupError?: string;
};

/** Node and GNU mktemp both put six (or more) random characters after the caller's mark. */
const RANDOM_SUFFIX = /^(.*[-.])([A-Za-z0-9]{6,})$/;

/**
 * Group leftover entry names by the stable prefix before the random suffix.
 * `enables-cfg-AbCdEf` and `enables-cfg-GhIjKl` are one prefix, `enables-cfg-`, counted twice.
 */
export function leakPrefixes(names: readonly string[]): readonly LeakPrefix[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const prefix = RANDOM_SUFFIX.exec(name)?.[1] ?? name;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
}

/** One prefix per line: `enables-cfg- 2`. */
export function formatLeaks(leaks: readonly LeakPrefix[]): string {
  return leaks.map((leak) => `${leak.prefix} ${String(leak.count)}`).join('\n');
}

/**
 * Run `command` at `root` with `TMPDIR` set to a fresh directory.
 * Always attempts cleanup, including when the lane fails or throws. Cleanup errors are
 * reported without replacing the lane's exit code, exception, or observed leftovers.
 */
export async function runInTmp(
  command: string,
  root: string,
  remove: typeof rm = rm,
): Promise<TmpRun> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-tmp-guard-'));
  let code: number;
  let leaks: readonly LeakPrefix[];
  let cleanupError: string | undefined;
  try {
    code = await runLane(command, root, { TMPDIR: dir });
    let names: readonly string[] = [];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
    leaks = leakPrefixes(names);
  } finally {
    // ⛔ A rejected rm in finally would mask the test result AND the leak evidence.
    try {
      await remove(dir, { recursive: true, force: true });
    } catch (error) {
      cleanupError = `could not remove temp guard ${dir}: ${String(error)}`;
      note(cleanupError);
    }
  }
  return { code, leaks, removed: dir, ...(cleanupError === undefined ? {} : { cleanupError }) };
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export { problemsInTmpLiterals } from './tmp-literals.ts';
