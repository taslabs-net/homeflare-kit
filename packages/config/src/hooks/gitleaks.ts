/**
 * Run gitleaks, and read what it SAYS as well as what it exits with.
 *
 * 🔴 gitleaks 8.30.1 EXITS 0 AND PRINTS "no leaks found" WHEN ITS OWN `git` FAILS. It shells out to
 *   `git log` (or `git diff --cached`), and when that dies — an unknown revision, an option this
 *   git does not know, a `--log-opts` split on a space in a path — it logs the stderr and
 *   carries on to "0 commits scanned", exit 0. Measured by the red team on 2026-10-01 with a
 *   real `git push "/path/remote 3.git"`: git failed, the hook printed ✓, and the secret landed.
 *   An exit code alone certifies nothing, so the output is read too.
 * ★ THE SHAPE OF A FAILURE, read from 8.30.1 rather than guessed (`gitleaks git --help` has no
 *   flag for it): with `--no-color`, zerolog's console writer prints `2:30PM ERR [git] fatal: bad
 *   object …` then `ERR error="stderr is not empty"`, on STDERR, and the run still ends
 *   `INF no leaks found`. `ERR`, `FTL` and `PNC` are the levels that mean it did not do its job;
 *   `[git]` marks git's own words. A finding is a `WRN` and a non-zero exit, and is not this.
 * ⚠️ `--no-color` is passed so the level is the second word on the line and not wrapped in escape
 *   codes; any that still arrive are stripped.
 */
import { withoutGitEnv } from './report.ts';

export type Gitleaks = {
  readonly code: number;
  /** The first line that says gitleaks (or the git under it) failed, if one did. */
  readonly broke: string | undefined;
};

const BROKEN = /^\s*\S+\s+(?:ERR|FTL|PNC)\s|\[git\]/;
const ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Run `gitleaks <args>`, echoing its stderr as it would have appeared.
 * `isolated` drops the inherited `GIT_*` — see `withoutGitEnv`.
 */
export async function runGitleaks(args: readonly string[], isolated = false): Promise<Gitleaks> {
  const proc = Bun.spawn(['gitleaks', ...args, '--no-color'], {
    stdout: 'inherit',
    stderr: 'pipe',
    ...(isolated ? { env: withoutGitEnv() } : {}),
  });
  const said = await new Response(proc.stderr).text();
  process.stderr.write(said);
  const broke = said
    .split('\n')
    .map((line) => line.replace(ESCAPES, ''))
    .find((line) => BROKEN.test(line));
  return { code: await proc.exited, broke: broke?.trim() };
}
