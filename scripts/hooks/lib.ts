/**
 * Shared helpers for the git hooks.
 *
 * ★ EVERY HOOK SCRIPT IS ONE CONCERN AND SAYS WHY IT FAILED. A hook that prints a bare
 *   non-zero exit leaves the contributor guessing. Hooks fail closed — there is no way round
 *   one — so the message is the whole product: what failed, and the command that fixes it.
 */

/**
 * Files staged for commit, excluding deletions (nothing to check in a deleted file).
 *
 * 🔴 `-z`, AND SPLIT ON NUL, for the reason staged.ts measured on 2026-09-22: without it git
 *   applies `core.quotePath`, and a workflow named `.github/workflows/café.yml` comes back as
 *   the quoted, octal-escaped `".github/workflows/caf\303\251.yml"`. That string does not start
 *   with `.github/workflows/`, so actionlint.ts read it as "no workflow changes" and a hook
 *   that fails closed passed a workflow it never linted. Every script here shares this one.
 */
export async function stagedFiles(): Promise<readonly string[]> {
  const proc = Bun.spawn(['git', 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {
    stdout: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  return out.split('\0').filter((line) => line.length > 0);
}

/**
 * Run a command, streaming its output. Returns its exit code.
 * ★ No `env` parameter any more: the one caller that needed it (the old full-`verify`
 *   pre-push) is gone, and the shared pre-push in @homeflare/config strips the hook's
 *   GIT_* itself — see packages/config/src/hooks/report.ts.
 */
export async function run(cmd: readonly string[]): Promise<number> {
  const proc = Bun.spawn([...cmd], { stdout: 'inherit', stderr: 'inherit' });
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
