/**
 * Adoption: the one wrapper every repo commits, and the check that it has not drifted.
 *
 * ★ WHY A WRAPPER AT ALL. husky can only run a file that is tracked in the repo, so
 *   something must be committed per repo. This keeps that something to a delegation
 *   whose text is owned HERE — the behaviour lives in one package, and a repo that
 *   edits its copy is reported as drift rather than quietly diverging.
 * ★ ONE FILE, TWO NAMES. The wrapper reads the hook name from `$0`, so `pre-commit`
 *   and `pre-push` are byte-identical and there is a single text to keep in step.
 */
import { chmod, mkdir } from 'node:fs/promises';

/** The hook files this package installs, in the order a contributor meets them. */
export const HOOK_NAMES = ['pre-commit', 'pre-push'] as const;

/** Where the runner lives once `bun install` has run. Relative: git runs hooks at the root. */
const RUNNER = 'node_modules/@homeflare/config/bin/hooks.ts';

/**
 * ⚠️ IT EXITS 0 WHEN THE RUNNER IS ABSENT. A checkout with no `node_modules` would
 *   otherwise fail every commit with a module-resolution error, and the first thing
 *   anyone would do is delete the hook. Failing open is the right trade for a
 *   convenience; the required checks on `main` are what must fail closed.
 */
export const HUSKY_HOOK: string = `# HomeFlare shared git hook. The behaviour lives in @homeflare/config, not in this file,
# and the same bytes are installed as .husky/pre-commit and .husky/pre-push — the hook
# name comes from $0.
#
# ⚠️ A hook is a local convenience, not a gate: it is skippable with --no-verify and does
#   not exist in a fresh clone until \`bun install\` runs the \`prepare\` script. The
#   required checks on main stay the gate.
#
# Regenerate this file with: bun ${RUNNER} install
hook="${RUNNER}"
if [ ! -f "$hook" ]; then
  echo "husky: $hook is missing — run 'bun install' to enable the HomeFlare hooks; skipping"
  exit 0
fi
exec bun "$hook" "$(basename "$0")"
`;

/** Write the wrapper into `.husky/`. Returns the paths written, relative to the project. */
export async function installHooks(projectDir: string): Promise<readonly string[]> {
  await mkdir(`${projectDir}/.husky`, { recursive: true });
  const written: string[] = [];
  for (const name of HOOK_NAMES) {
    const path = `${projectDir}/.husky/${name}`;
    await Bun.write(path, HUSKY_HOOK);
    // ⚠️ husky's own runner does `sh -e "$s"`, which does not need the execute bit, but
    //   `core.hooksPath=.husky` without husky does. Set it so both mechanisms work.
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
  const pkg = (await manifest.json()) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  if (!(pkg.scripts?.['prepare'] ?? '').includes('husky')) {
    problems.push('package.json: no "prepare": "husky" script — a fresh clone installs no hooks');
  }
  if (pkg.devDependencies?.['husky'] === undefined) {
    problems.push('package.json: husky is not a devDependency');
  }

  for (const name of HOOK_NAMES) {
    const file = Bun.file(`${projectDir}/.husky/${name}`);
    if (!(await file.exists())) {
      problems.push(`.husky/${name}: missing — run \`bun ${RUNNER} install\``);
      continue;
    }
    if ((await file.text()) !== HUSKY_HOOK) {
      problems.push(
        `.husky/${name}: differs from the @homeflare/config wrapper — run \`bun ${RUNNER} install\`, or change it in the package`,
      );
    }
  }

  return problems;
}
