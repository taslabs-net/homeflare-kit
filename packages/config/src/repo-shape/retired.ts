/**
 * Rendered paths this package stopped rendering — the "no fossils" list.
 *
 * ★ WHY THIS EXISTS. `renderRepoShape` only emits the files a shape asks for today; it
 *   never says what it used to emit, and `refreshRepoShape` only writes what it renders —
 *   so a file retired from the renderer was never deleted by a refresh. It just stopped
 *   being updated, silently, forever, in every repository that had already taken it.
 *
 *   MEASURED 2026-09-24: `@homeflare/config` 0.12.0 (kit PR 199) stopped rendering
 *   `.github/workflows/dependabot-automerge.yml`. Every consumer that had refreshed to
 *   0.12.0 before this module existed (homeflare-wiki bump PR 19, homeflare-mini bump
 *   PR 47) kept the dead file, and `driftInRepoShape` never said so — it only compares
 *   paths the CURRENT shape renders, and a retired path is not one of those.
 *
 * ⛔ RETIRING A PATH IS A ONE-WAY DOOR, NOT A RENAME. Once a path is here it can never
 *   become a `RenderedPath` again: `render.ts` would start writing a file this module is
 *   also trying to delete, and every refresh would fight itself. Give the replacement a
 *   new path instead. `repo-shape-retired.test.ts` asserts the two lists never overlap.
 *
 * ⚠️ DELETION IS GATED ON PROOF, NOT ON THE PATH ALONE. A repository can have a
 *   hand-written file sitting at the exact path a retired renderer used to own — a fork of
 *   the old rendered file, kept on purpose, or unrelated content that just landed there.
 *   `wasRenderedByUs` is the proof: every renderer in this directory writes the
 *   `🤖 RENDERED BY @homeflare/config` line into its header (grep the directory for it),
 *   and that line is the one thing a hand-written file has no reason to contain.
 *   `refreshRepoShape` deletes a retired path only when the line is present; otherwise it
 *   refuses and reports the path, the same way it refuses to overwrite an excepted file.
 */
import { requireSemver, requireSentence } from './guards.ts';

/**
 * A path `@homeflare/config` no longer renders, but may still find committed in a
 * repository that refreshed before the retirement. Extend this union at the same time a
 * path is added to `RETIRED_FILES` below — never reuse one already there.
 */
export type RetiredPath = '.github/workflows/dependabot-automerge.yml';

export interface RetiredFile {
  /** The path this package rendered, once. */
  readonly path: RetiredPath;
  /** The `@homeflare/config` version whose release stopped rendering it. */
  readonly retiredIn: string;
  /** Why, and which kit change did it — written at the retirement, like `except()`'s reason. */
  readonly reason: string;
}

function retire(file: RetiredFile): RetiredFile {
  return {
    path: file.path,
    reason: requireSentence('retired reason', file.reason),
    retiredIn: requireSemver(file.retiredIn),
  };
}

/** Every path `@homeflare/config` used to render, oldest retirement first. */
export const RETIRED_FILES: readonly RetiredFile[] = [
  retire({
    path: '.github/workflows/dependabot-automerge.yml',
    reason:
      'kit PR 199 retired the Dependabot @homeflare group; taslabs-net/homeflare-bumper ' +
      "carries a kit release into each consumer now, over the kit's own release workflow",
    retiredIn: '0.12.0',
  }),
];

/**
 * The substring every generated file's header has carried since this package's first
 * renderer. Kept independent of the four current renderers' own copies of this text
 * (`ci.ts`, `security.ts`, `dependabot.ts`, `companions.ts`) on purpose: a future wording
 * change to the live header must not stop this module recognising a file rendered under
 * the old one.
 */
export const GENERATED_FILE_MARKER = '🤖 RENDERED BY @homeflare/config';

/**
 * Whether `content` is provably a file this package once wrote.
 *
 * ⚠️ THE MARKER HAS TO START A LINE OF ITS OWN, NOT MERELY OCCUR SOMEWHERE IN THE TEXT.
 *   Every real header carries it as a whole comment line — `# 🤖 RENDERED BY
 *   @homeflare/config — DO NOT EDIT…`, third line in every renderer in this directory, so
 *   this does not require it to be the FIRST line — but a bare `content.includes(...)`
 *   would also match a hand-written file that merely *talks about* the marker, e.g. a
 *   comment reading "this file used to be 🤖 RENDERED BY @homeflare/config before it was
 *   retired; keeping it by hand now" — adversarial review, 2026-09-24, caught this exact
 *   case before it shipped. Requiring the marker at the start of a trimmed line is what a
 *   sentence built around it, rather than a header line consisting of it, cannot satisfy.
 *   `repo-shape-retired.test.ts` asserts the mid-sentence form stays refused.
 *
 * ⚠️ STILL A PREFIX CHECK ON THAT LINE, NOT A FULL-LINE EXACT MATCH. The retired renderer
 *   varied its trailing header prose by `shape.runner` and by repository name, and a
 *   future wording change to what follows the marker on a live renderer's header must not
 *   stop this recognising a file rendered under the old wording — only the marker itself,
 *   `🤖 RENDERED BY @homeflare/config`, has been constant across every renderer this
 *   package has ever shipped.
 */
export function wasRenderedByUs(content: string): boolean {
  return content
    .split('\n')
    .some((line) => line.trimStart().startsWith(`# ${GENERATED_FILE_MARKER}`));
}

/**
 * The message `driftInRepoShape` reports for a retired path that is still present, and
 * `repoShapeCli --check` prints verbatim. Names the fix command either way — whether that
 * command can actually remove the file depends on `wasRenderedByUs`, which only
 * `refreshRepoShape` (holding the file's contents) can decide.
 */
export function retiredFileProblem(file: RetiredFile): string {
  return (
    `${file.path}: retired in @homeflare/config@${file.retiredIn} (${file.reason}) ` +
    'but still present — run `bun run repo-shape:refresh` to remove it'
  );
}
