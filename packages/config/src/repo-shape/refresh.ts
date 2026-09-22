/**
 * The writer, and the CLI a repository wires to `repo-shape:refresh`.
 *
 * ⛔ SEPARATE FROM THE CHECK, ON PURPOSE. `drift.ts` never writes and this never gates;
 *   a tool that did both would repair the working tree during CI and report green on a
 *   repository whose committed files are still wrong.
 *
 * ★ IT ONLY WRITES WHAT CHANGED. An unchanged file keeps its mtime, so a refresh in a
 *   watch-mode session does not restart anything, and `git status` after a no-op refresh
 *   is empty rather than "14 files touched".
 *
 * ⚠️ IT NEVER WRITES AN EXCEPTED FILE. Refreshing a file the repository declared it owns
 *   would overwrite the deviation the reason was written for — the one destructive thing
 *   this could do, and the one it must not.
 */
import { REFRESH_COMMAND, driftInRepoShape, exceptionSummary } from './drift.ts';
import { renderRepoShape } from './render.ts';
import { type RepoShape, isExcepted } from './shape.ts';
import type { RenderedPath } from './shape.ts';

export interface RefreshResult {
  /** Paths written because their content changed or they were absent. */
  readonly written: readonly string[];
  /** Paths already correct. */
  readonly unchanged: readonly string[];
  /** Paths skipped because the shape declares an exception for them. */
  readonly skipped: readonly string[];
}

/** Write a repository's rendered files into `projectDir`. */
export async function refreshRepoShape(
  projectDir: string,
  shape: RepoShape,
): Promise<RefreshResult> {
  const rendered = renderRepoShape(shape);
  const written: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];

  for (const [path, contents] of Object.entries(rendered.files)) {
    if (isExcepted(shape, path as RenderedPath)) {
      skipped.push(path);
      continue;
    }
    const target = `${projectDir}/${path}`;
    const file = Bun.file(target);
    if ((await file.exists()) && (await file.text()) === contents) {
      unchanged.push(path);
      continue;
    }
    await Bun.write(target, contents);
    written.push(path);
  }

  return { skipped, unchanged, written };
}

/**
 * ★ `Bun.write(Bun.stdout, …)` RATHER THAN `console.log`. Two reasons, and the lint rule
 *   is the lesser: a CLI's output is a stream it owns, and writing to it explicitly is
 *   what lets `repoShapeCli` be called in a test and in a `repo-shape.ts` without either
 *   one inheriting a global. `console` in `src/` is also off-limits in the house preset —
 *   allowed under `tests/**` and `scripts/**`, and this is neither.
 */
async function say(
  stream: typeof Bun.stdout | typeof Bun.stderr,
  lines: readonly string[],
): Promise<void> {
  if (lines.length === 0) return;
  await Bun.write(stream, `${lines.join('\n')}\n`);
}

/**
 * The `repo-shape:refresh` entry point. `--check` reports drift and exits non-zero
 * instead of writing, which is what a repository puts in CI when it does not want the
 * check inside `bun test`.
 */
export async function repoShapeCli(
  projectDir: string,
  shape: RepoShape,
  argv: readonly string[],
): Promise<number> {
  if (argv.includes('--check')) {
    const report = await driftInRepoShape(projectDir, shape);
    // ★ The exceptions are printed on a PASSING run too. An exception that stops being
    //   visible is an exception that stops being reconsidered.
    await say(
      Bun.stdout,
      exceptionSummary(shape).map((note) => `· ${note}`),
    );
    if (report.problems.length === 0) {
      const count = report.excepted.length;
      await say(Bun.stdout, [
        `repo shape: in step with @homeflare/config (${count} declared exception(s))`,
      ]);
      return 0;
    }
    await say(Bun.stderr, [
      ...report.problems.map((problem) => `✗ ${problem}`),
      '',
      `Run \`${REFRESH_COMMAND}\`, or declare the deviation with a reason.`,
    ]);
    return 1;
  }

  const result = await refreshRepoShape(projectDir, shape);
  await say(Bun.stdout, [
    ...result.written.map((path) => `wrote    ${path}`),
    ...result.unchanged.map((path) => `ok       ${path}`),
    ...result.skipped.map((path) => `excepted ${path}`),
  ]);
  return 0;
}
