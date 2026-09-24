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
 *
 * ⚠️ IT DELETES A RETIRED FILE ONLY WHEN IT CAN PROVE IT RENDERED IT. `RETIRED_FILES`
 *   (`retired.ts`) names every path this package used to render; `wasRenderedByUs` is the
 *   proof — the file still carries the generated-file header. A retired path present
 *   without that header is left alone and reported as refused, on the same reasoning as
 *   never overwriting an excepted file: this writer only ever removes what it is sure is
 *   its own.
 */
import { REFRESH_COMMAND, driftInRepoShape, exceptionSummary } from './drift.ts';
import { renderRepoShape } from './render.ts';
import { RETIRED_FILES, wasRenderedByUs } from './retired.ts';
import { type RepoShape, isExcepted } from './shape.ts';
import type { RenderedPath } from './shape.ts';

export interface RefreshResult {
  /** Paths written because their content changed or they were absent. */
  readonly written: readonly string[];
  /** Paths already correct. */
  readonly unchanged: readonly string[];
  /** Paths skipped because the shape declares an exception for them. */
  readonly skipped: readonly string[];
  /** Retired paths deleted because they still carried the generated-file header. */
  readonly removed: readonly string[];
  /** Retired paths left alone because they did not — provably hand-written, not ours. */
  readonly refused: readonly string[];
}

/** Write a repository's rendered files into `projectDir`, and clear its rendered fossils. */
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

  const { refused, removed } = await clearRetiredFiles(projectDir);

  return { refused, removed, skipped, unchanged, written };
}

/**
 * Delete every retired path this package can prove it rendered; leave every other one, and
 * say so. A path absent from `projectDir` is neither removed nor refused — there is
 * nothing there to have an opinion about.
 */
async function clearRetiredFiles(
  projectDir: string,
): Promise<{ removed: string[]; refused: string[] }> {
  const removed: string[] = [];
  const refused: string[] = [];

  for (const retiredFile of RETIRED_FILES) {
    const target = `${projectDir}/${retiredFile.path}`;
    const file = Bun.file(target);
    if (!(await file.exists())) continue;

    if (wasRenderedByUs(await file.text())) {
      await file.delete();
      removed.push(retiredFile.path);
    } else {
      refused.push(retiredFile.path);
    }
  }

  return { refused, removed };
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
    ...result.removed.map((path) => `removed  ${path} (retired; carried our header)`),
  ]);
  // ★ ON ITS OWN LINE, TO STDERR: a refused retired file is the one outcome here that
  //   still needs a person. `--check` (above) keeps failing on it — it reports any retired
  //   path that is present, proof or not — so this is not the only place it is said, but
  //   it is the only place that says WHY refresh did not just fix it.
  await say(
    Bun.stderr,
    result.refused.map(
      (path) =>
        `refused  ${path} — present but not provably ours; not deleted. See docs/repo-shape-retired.md.`,
    ),
  );
  return 0;
}
