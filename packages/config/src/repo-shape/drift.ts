/**
 * The drift check: re-render, compare, and say what to run.
 *
 * ★ WHAT MAKES THIS DIFFERENT FROM A LINT RULE. It does not describe good workflows; it
 *   asserts that this repository's committed files ARE the rendered ones. A hand edit
 *   fails here before it can spread, which is the mechanism — not the convention — that
 *   keeps fourteen repositories the same.
 *
 * ⛔ IT REPORTS, IT DOES NOT REPAIR, exactly like `checkProject` in this package. A check
 *   that silently rewrote the working tree would erase the evidence of what someone
 *   changed, and the one case worth catching — a deliberate edit that should have been an
 *   exception — is the case it would erase. `refresh.ts` is the separate, explicit writer.
 *
 * ⚠️ EVERY COMPARISON IS EXACT TEXT, NOT STRUCTURE. `checkProject` compares parsed values
 *   because a project may reformat its copy of a preset. Here the file IS generated, so
 *   any difference at all — including a reflowed comment — means the file did not come
 *   out of the renderer, and reformatting it would defeat the point of generating it.
 *   The one exception is line endings, normalised so a CRLF checkout is not "drift".
 */
import { type RenderedRepo, renderRepoShape } from './render.ts';
import { RETIRED_FILES, retiredFileProblem } from './retired.ts';
import type { RenderedPath, RepoShape, RepoShapeException } from './shape.ts';

/** One thing to fix, in the imperative — the same `Problem` shape `./check` reports. */
export type Problem = string;

/** The command that makes a difference go away. Printed with every drift problem. */
export const REFRESH_COMMAND = 'bun run repo-shape:refresh';

function normalize(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

async function readIfPresent(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? normalize(await file.text()) : undefined;
}

/**
 * ⛔ AN EXCEPTION FOR A FILE THE SHAPE DOES NOT RENDER IS ITSELF A PROBLEM. Otherwise a
 *   repository that moved from the mini to GitHub-hosted runners would keep a stale
 *   `.github/actionlint.yaml` exception forever, and the exception list — the one place
 *   that is supposed to hold every deviation — would be lying about one of them.
 */
function staleExceptions(
  rendered: RenderedRepo,
  exceptions: readonly RepoShapeException[],
): Problem[] {
  return exceptions
    .filter((exception) => rendered.files[exception.file] === undefined)
    .map(
      (exception) =>
        `${exception.file}: excepted (since ${exception.since}) but this shape renders no such file — drop the exception`,
    );
}

/**
 * ⚠️ A DUPLICATE EXCEPTION HIDES A REASON. Two `except()` entries for one file means one
 *   of the two reasons is never read, and the one that loses is arbitrary. Refuse both.
 */
function duplicateExceptions(exceptions: readonly RepoShapeException[]): Problem[] {
  const seen = new Set<RenderedPath>();
  const duplicated = new Set<RenderedPath>();
  for (const exception of exceptions) {
    if (seen.has(exception.file)) duplicated.add(exception.file);
    seen.add(exception.file);
  }
  return [...duplicated].map(
    (file) => `${file}: declared as an exception more than once — keep one, with one reason`,
  );
}

/**
 * ★ A RETIRED PATH IS REPORTED WHETHER OR NOT IT IS PROVABLY OURS. This check only reads
 *   the file to see if it is THERE — `wasRenderedByUs` is `refreshRepoShape`'s call to
 *   make, because only the writer should decide whether to delete. Reporting here is what
 *   makes a fossil visible even in a repository that only ever runs `--check` in CI.
 */
async function retiredFilesPresent(projectDir: string): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const file of RETIRED_FILES) {
    if ((await readIfPresent(`${projectDir}/${file.path}`)) !== undefined) {
      problems.push(retiredFileProblem(file));
    }
  }
  return problems;
}

export interface DriftReport {
  /** Empty when the committed files are the rendered ones and no retired path lingers. */
  readonly problems: readonly Problem[];
  /** Paths whose committed text differs from the render, excluding excepted files. */
  readonly drifted: readonly string[];
  /** Paths the repository declared it owns, with the reason it gave. */
  readonly excepted: readonly RepoShapeException[];
}

/**
 * Compare a repository's committed tooling files against its declared shape.
 *
 *     const report = await driftInRepoShape(process.cwd(), shape);
 *     expect(report.problems).toEqual([]);
 *
 * A declared exception passes. An undeclared difference fails, and so does a missing file.
 */
export async function driftInRepoShape(projectDir: string, shape: RepoShape): Promise<DriftReport> {
  const rendered = renderRepoShape(shape);
  const exceptions = shape.exceptions ?? [];
  const excepted = new Map(exceptions.map((exception) => [exception.file as string, exception]));
  const problems: Problem[] = [
    ...duplicateExceptions(exceptions),
    ...staleExceptions(rendered, exceptions),
    ...(await retiredFilesPresent(projectDir)),
  ];
  const drifted: string[] = [];

  for (const [path, expected] of Object.entries(rendered.files)) {
    if (excepted.has(path)) continue;
    const actual = await readIfPresent(`${projectDir}/${path}`);
    if (actual === undefined) {
      problems.push(`${path}: missing — run \`${REFRESH_COMMAND}\``);
      drifted.push(path);
      continue;
    }
    if (actual !== normalize(expected)) {
      drifted.push(path);
      problems.push(
        `${path}: differs from what @homeflare/config renders for this shape. ` +
          `Run \`${REFRESH_COMMAND}\` to take the standard, ` +
          `or declare it with except({ file: '${path}', reason: '…', since: '…' }) in repo-shape.ts.`,
      );
    }
  }

  return { drifted, excepted: exceptions, problems };
}

/**
 * Every rendered path that is NOT compared, with why. For a report, not for a gate.
 * ★ Printed by `refresh --check` so a passing run still names what it did not check.
 *   An exception that stops being visible is an exception that stops being reconsidered.
 */
export function exceptionSummary(shape: RepoShape): readonly string[] {
  return (shape.exceptions ?? []).map(
    (exception) =>
      `${exception.file}: not checked — ${exception.reason} (since ${exception.since})`,
  );
}
