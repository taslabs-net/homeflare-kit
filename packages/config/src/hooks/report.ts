/**
 * How a hook talks to whoever triggered it.
 *
 * ★ EVERY FAILURE PRINTS BOTH COMMANDS — the one that fixes it and the one that skips
 *   it. A hook that exits non-zero and says nothing teaches `--no-verify` as a reflex,
 *   and that switch turns off every check rather than the one that was wrong.
 *
 * ⚠️ Output goes to STDERR. Git hooks share stdout with porcelain in some flows, and a
 *   hook that writes there can corrupt what a caller is parsing.
 */

/** The two hooks this package implements. Named exactly as the git hook files are. */
export type Hook = 'pre-commit' | 'pre-push';

const BYPASS: Record<Hook, string> = {
  'pre-commit': 'git commit --no-verify',
  'pre-push': 'git push --no-verify',
};

/**
 * 🔴 A GIT HOOK EXPORTS `GIT_DIR` AND `GIT_INDEX_FILE`, AND EVERYTHING IT SPAWNS
 *   INHERITS THEM. Measured 2026-09-22 at the cost of two junk files and a stray commit
 *   on this repository's `main`: `pre-push` runs `bun run check`, `check` runs the test
 *   suite, and a test that builds a throwaway git repository and commits in it commits
 *   into THIS repository instead — `cwd` is ignored once `GIT_DIR` is set. The estate's
 *   own `packages/site/tests/checkout.test.ts` already carried a comment warning about
 *   exactly this, which is how much a convention is worth.
 * ⛔ So the hook strips them rather than trusting fourteen test suites to remember. The
 *   gate must see the repository through `cwd`, the way CI does.
 */
export function withoutGitEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
}

/**
 * Run a command, streaming its output. Returns its exit code.
 * `isolated` drops the inherited `GIT_*` variables — see `withoutGitEnv`.
 */
export async function run(cmd: readonly string[], isolated = false): Promise<number> {
  const proc = Bun.spawn([...cmd], {
    stdout: 'inherit',
    stderr: 'inherit',
    ...(isolated ? { env: withoutGitEnv() } : {}),
  });
  return await proc.exited;
}

/** Capture a command's stdout. Used for git plumbing only. */
export async function capture(cmd: readonly string[]): Promise<string> {
  return (await probe(cmd)).stdout;
}

/**
 * Run a command, relaying its stdout live-enough (after it exits) while also handing the
 * caller the text — gates.ts reads oxfmt's own "on N files" summary from it. `stderr` stays
 * `inherit`: diagnostics (a parse error, "no files matched") must show immediately, and nothing
 * here needs to inspect them.
 */
export async function runCaptured(
  cmd: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string }> {
  const proc = Bun.spawn([...cmd], { stdout: 'pipe', stderr: 'inherit' });
  const stdout = await new Response(proc.stdout).text();
  process.stdout.write(stdout);
  return { code: await proc.exited, stdout };
}

/** Capture a command's stdout AND its exit code — git plumbing that answers by status. */
export async function probe(cmd: readonly string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn([...cmd], { stdout: 'pipe', stderr: 'ignore' });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout };
}

/**
 * Run one pre-push lane through `sh -c` at `root`, as `bun run` would run a script line.
 *
 * ⚠️ `node_modules/.bin` FIRST ON PATH, because a lane opened up from a script is no longer
 *   run by `bun run`, which is what used to put it there — `vitest` or `oxfmt` in an expanded
 *   script would otherwise be "command not found" on a machine without a global copy.
 * 🔴 AND WITHOUT THE HOOK'S `GIT_*` — see `withoutGitEnv`.
 */
export async function runLane(command: string, root: string): Promise<number> {
  const env = withoutGitEnv();
  env['PATH'] = `${root}/node_modules/.bin:${env['PATH'] ?? ''}`;
  const proc = Bun.spawn(['sh', '-c', command], {
    cwd: root,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return await proc.exited;
}

/**
 * Resolve a dev tool to the project's own copy.
 *
 * ⚠️ NOT `bunx` BY DEFAULT. On a cache miss `bunx` downloads from the registry, and a
 *   git hook that reaches the network mid-commit is a hang waiting for a flaky link.
 *   Git runs the hook with the caller's PATH, which has no `node_modules/.bin` (husky
 *   used to add it; the hooks no longer run through husky), so the local binary is named
 *   outright when it exists and `bunx` is only the fallback.
 */
export function tool(root: string, name: string): readonly string[] {
  const local = `${root}/node_modules/.bin/${name}`;
  return Bun.file(local).size > 0 ? [local] : ['bunx', name];
}

/**
 * ⚠️ `process.stderr.write`, NOT `console`. Two reasons, and the lint rule is the lesser
 *   one: a hook shares stdout with git porcelain in some flows, and a synchronous write
 *   is the only kind guaranteed to land before `process.exit` below throws the buffer
 *   away. Using `console.error` here would also make every consumer of this package
 *   need a `no-console` exemption for code they never call directly.
 */
function line(text: string): void {
  process.stderr.write(`${text}\n`);
}

export function ok(what: string): void {
  line(`✓ ${what}`);
}

export function note(what: string): void {
  line(`  ${what}`);
}

/** ⛔ ALWAYS GIVE THE FIX. "lint failed" is a dead end; the command that repairs it is not. */
export function fail(hook: Hook, what: string, fix: string): never {
  line(`\n✗ ${hook}: ${what}`);
  line(`  fix:    ${fix}`);
  line(`  bypass: ${BYPASS[hook]}  — CI still runs the real gate\n`);
  process.exit(1);
}
