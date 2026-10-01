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
 * ⛔ IT EXITS 1 WHEN THE RUNNER IS ABSENT. A worktree with no `node_modules` cannot run the
 *   checks, and a gate that cannot run is fixed, never skipped (Tim, 2026-10-01): the
 *   wrapper stops the commit or push with one line naming the fix, `bun install`, instead
 *   of letting it through unchecked. It used to exit 0 there, on the argument that a hook
 *   is a convenience and CI is the gate; that left every fresh worktree committing with
 *   no checks at all, which is the exact gap `core.hooksPath` exists to close (activate.ts).
 * ⛔ IT ALSO EXITS 1 WHEN `bun` IS NOT ON PATH. Without that check the shell's own "exec: bun: not
 *   found" was the whole message — no fix line, on a machine whose fix is installing bun.
 * ★ `"$@"` AND STDIN PASS THROUGH. `pre-push` reads the remote name from its first argument
 *   and the pushed refs from stdin (push-range.ts); `exec` keeps both.
 * ⚠️ NO SHEBANG, AND THAT IS MEASURED, NOT FORGOTTEN: git 2.55 runs an executable hook that
 *   has none through `sh` (2026-09-23), and the husky-era files in the estate have none.
 */
export const HUSKY_HOOK: string = `# HomeFlare shared git hook. The behaviour lives in @homeflare/config, not in this file,
# and the same bytes are installed as .husky/pre-commit and .husky/pre-push — the hook
# name comes from $0, and git's arguments and stdin pass straight through.
#
# ⛔ It fails closed. A worktree can run this hook only once \`bun install\` has run there;
#   until then the runner is missing, and the commit or push stops with the fix. CI still
#   runs the whole gate on every pull request.
#
# Regenerate this file with: bun ${RUNNER} install
hook="${RUNNER}"
if ! command -v bun >/dev/null 2>&1; then
  echo "homeflare hooks: bun is not on PATH — install bun (https://bun.sh), then run 'bun install' in this worktree" >&2
  exit 1
fi
if [ ! -f "$hook" ]; then
  echo "homeflare hooks: $hook is missing — run 'bun install' in this worktree" >&2
  exit 1
fi
exec bun "$hook" "$(basename "$0")" "$@"
`;

/**
 * The first line of every wrapper this package has written — the first release's, the
 * every-worktree one's, and this one's. It is how the runner tells "our wrapper, out of date"
 * from "a hook file this repo wrote for itself".
 */
export const WRAPPER_MARKER = '# HomeFlare shared git hook';

/**
 * Is this project's committed `.husky/<name>` one of OUR wrappers that is not the current one?
 * Returns the failure to print, or `undefined` when there is nothing to say.
 *
 * ⛔ A STALE WRAPPER IS THE ROLLOUT HOLE, and nothing else closes it. A consumer picks up a new
 *   `@homeflare/config` through the version bumper, which refreshes the dependency and not
 *   `.husky/*`, so the committed copy keeps its old bytes — an old wrapper that exited 0 with
 *   no `node_modules` — until a person happens to run `install`. The runner calls this on every
 *   commit and push, so the first one after the upgrade stops and says how to refresh it.
 * ⚠️ ONLY A FILE THAT STARTS WITH THE MARKER IS COMPARED. This repository's own `.husky/`
 *   files are written by hand — they run the shared runner and then kit-only scripts — and
 *   `install` would overwrite them with the wrapper, losing those scripts. A hook file a repo
 *   wrote for itself is its own business; `problemsInHooks` is where a repo opts into the rest.
 */
export async function wrapperDrift(
  projectDir: string,
  name: (typeof HOOK_NAMES)[number],
): Promise<{ readonly what: string; readonly fix: string } | undefined> {
  const file = Bun.file(`${projectDir}/.husky/${name}`);
  if (!(await file.exists())) return undefined;
  const text = await file.text();
  if (!text.startsWith(WRAPPER_MARKER) || text === HUSKY_HOOK) return undefined;
  return {
    what: `.husky/${name} is an out-of-date or edited @homeflare/config wrapper`,
    fix: `bun ${RUNNER} install — then commit .husky/pre-commit and .husky/pre-push`,
  };
}

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
