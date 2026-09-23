/**
 * Shared helpers for the git hooks.
 *
 * ★ EVERY HOOK SCRIPT IS ONE CONCERN AND SAYS WHY IT FAILED. A hook that prints a bare
 *   non-zero exit teaches contributors to reach for `--no-verify`, which disables the
 *   whole gate rather than the one check that was wrong.
 */

/** Files staged for commit, excluding deletions (nothing to check in a deleted file). */
export async function stagedFiles(): Promise<readonly string[]> {
  const proc = Bun.spawn(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    stdout: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  return out.split('\n').filter((line) => line.length > 0);
}

/**
 * Run a command, streaming its output. Returns its exit code.
 * ⚠️ `env` exists for one reason — see the comment in `verify.ts`. A hook that passes its
 *   inherited GIT_DIR to a test suite lets a test commit into the repository being
 *   pushed.
 */
export async function run(
  cmd: readonly string[],
  env?: Record<string, string | undefined>,
): Promise<number> {
  const proc = Bun.spawn([...cmd], {
    stdout: 'inherit',
    stderr: 'inherit',
    ...(env === undefined ? {} : { env }),
  });
  return await proc.exited;
}

/**
 * Fail the hook with an explanation and, where one exists, the command that fixes it.
 * ⛔ ALWAYS GIVE THE FIX. "lint failed" is a dead end; "run bun run lint:fix" is not.
 */
export function fail(what: string, fix?: string): never {
  console.error(`\n✗ ${what}`);
  if (fix !== undefined) console.error(`  fix: ${fix}\n`);
  process.exit(1);
}

export function ok(what: string): void {
  console.error(`✓ ${what}`);
}
