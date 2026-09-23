/**
 * Adoption: the one wrapper every repo commits, and the check that it has not drifted.
 *
 * ★ WHY A WRAPPER AT ALL. git can only run a file that is present in the worktree, so
 *   something must be committed per repo. This keeps that something to a delegation
 *   whose text is owned HERE — the behaviour lives in one package, and a repo that
 *   edits its copy is reported as drift rather than quietly diverging.
 * ★ ONE FILE, TWO NAMES. The wrapper reads the hook name from `$0`, so `pre-commit`
 *   and `pre-push` are byte-identical and there is a single text to keep in step.
 * ★ THE DIRECTORY KEEPS HUSKY'S NAME, NOT HUSKY. `.husky/` is where the estate's hook files
 *   already live (homeflare-kit, homeflare-alerts, the house monorepo); since 2026-09-23 git
 *   runs them directly through `core.hooksPath` — see activate.ts for why husky's own
 *   `.husky/_` left every fresh worktree without hooks.
 */
import { chmod, mkdir, stat } from 'node:fs/promises';

/** The hook files this package installs, in the order a contributor meets them. */
export const HOOK_NAMES = ['pre-commit', 'pre-push'] as const;

/** Where the runner lives once `bun install` has run. Relative: git runs hooks at the root. */
const RUNNER = 'node_modules/@homeflare/config/bin/hooks.ts';

/** What a consumer's `prepare` script runs, so every `bun install` activates the hooks. */
export const PREPARE: string = `bun ${RUNNER} activate`;

/**
 * ⚠️ IT EXITS 0 WHEN THE RUNNER IS ABSENT. A worktree with no `node_modules` would
 *   otherwise fail every commit with a module-resolution error, and the first thing
 *   anyone would do is delete the hook. Failing open is the right trade for a
 *   convenience; the required checks on `main` are what must fail closed.
 * ★ `"$@"` AND STDIN PASS THROUGH. `pre-push` reads the remote name from its first argument
 *   and the pushed refs from stdin (push-range.ts); `exec` keeps both.
 * ⚠️ NO SHEBANG, AND THAT IS MEASURED, NOT FORGOTTEN: git 2.55 runs an executable hook that
 *   has none through `sh` (2026-09-23), and the husky-era files in the estate have none.
 */
export const HUSKY_HOOK: string = `# HomeFlare shared git hook. The behaviour lives in @homeflare/config, not in this file,
# and the same bytes are installed as .husky/pre-commit and .husky/pre-push — the hook
# name comes from $0, and git's arguments and stdin pass straight through.
#
# ⚠️ A hook is a local convenience, not a gate: it is skippable with --no-verify, and a
#   worktree runs it only once \`bun install\` has run there. The required checks on main
#   stay the gate.
#
# Regenerate this file with: bun ${RUNNER} install
hook="${RUNNER}"
if [ ! -f "$hook" ]; then
  echo "homeflare hooks: $hook is missing — run 'bun install' in this worktree; skipping" >&2
  exit 0
fi
exec bun "$hook" "$(basename "$0")" "$@"
`;

/** Write the wrapper into `.husky/`. Returns the paths written, relative to the project. */
export async function installHooks(projectDir: string): Promise<readonly string[]> {
  await mkdir(`${projectDir}/.husky`, { recursive: true });
  const written: string[] = [];
  for (const name of HOOK_NAMES) {
    const path = `${projectDir}/.husky/${name}`;
    await Bun.write(path, HUSKY_HOOK);
    // ⛔ THE EXECUTE BIT IS REQUIRED. git runs a `core.hooksPath` file directly and IGNORES
    //   a non-executable hook, with nothing but an advice line to say so.
    await chmod(path, 0o755);
    written.push(`.husky/${name}`);
  }
  return written;
}

/**
 * Report what stops this project's hooks from working. Empty means adopted.
 *
 * ⛔ DELIBERATELY NOT PART OF `checkProject`. Every repo in the estate runs that checker
 *   from a test; folding hook conformance into it would turn every repo that has not
 *   adopted yet red on `main` in the same commit. A repo opts in by calling this.
 */
export async function problemsInHooks(projectDir: string): Promise<readonly string[]> {
  const problems: string[] = [];
  const manifest = Bun.file(`${projectDir}/package.json`);

  if (!(await manifest.exists())) return ['package.json: missing'];
  const pkg = (await manifest.json()) as { scripts?: Record<string, string> };

  const prepare = pkg.scripts?.['prepare'] ?? '';
  if (!/bin\/hooks\.ts activate/.test(prepare)) {
    problems.push(
      `package.json: "prepare" does not run \`${PREPARE}\` — no clone or worktree gets hooks`,
    );
  }
  // ⚠️ husky POINTS core.hooksPath AT AN UNTRACKED `.husky/_` that exists only where it ran —
  //   the gap activate.ts closes. Left in `prepare`, it undoes the activation.
  if (/\bhusky\b/.test(prepare)) {
    problems.push(
      'package.json: "prepare" still runs husky, which re-points core.hooksPath at .husky/_',
    );
  }

  for (const name of HOOK_NAMES) {
    const path = `${projectDir}/.husky/${name}`;
    const file = Bun.file(path);
    if (!(await file.exists())) {
      problems.push(`.husky/${name}: missing — run \`bun ${RUNNER} install\``);
      continue;
    }
    if ((await file.text()) !== HUSKY_HOOK) {
      problems.push(
        `.husky/${name}: differs from the @homeflare/config wrapper — run \`bun ${RUNNER} install\`, or change it in the package`,
      );
    }
    if (((await stat(path)).mode & 0o111) === 0) {
      problems.push(`.husky/${name}: not executable, so git ignores it — chmod +x it and commit`);
    }
  }

  return problems;
}
