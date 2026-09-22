/**
 * `renderRepoShape` — one declaration, both halves of a standard repository.
 *
 * ★ THIS IS THE POINT OF THE WHOLE MODULE. A repository declares its shape once and gets
 *   its FILES (here) and its GitHub SETTINGS (through `policy`, which is the options
 *   object `@homeflare/alchemy`'s `declareRepoPolicy` takes). Before this, the workflow
 *   that produces a status check and the ruleset that requires that status check were
 *   written in two files by hand, and nothing connected them: renaming the aggregate job
 *   would leave a required check that never reports, and a pull request would wait on it
 *   forever with auto-merge armed. `checks` below is derived from the rendered workflows,
 *   so the two cannot disagree.
 *
 * ⛔ NO IMPORT CROSSES BETWEEN THE PACKAGES, IN EITHER DIRECTION. `policy` is a plain
 *   object that is structurally assignable to `RepoPolicyOptions`; `@homeflare/alchemy`
 *   does not depend on `@homeflare/config` and this does not depend on Alchemy or Effect.
 *   That matters because `@homeflare/config` is installed in 13 of 14 repositories and
 *   `@homeflare/alchemy` in 4 — the drift check has to run everywhere, and it must not
 *   drag a provider library into a repository that has no stack.
 *   ⚠️ A structural seam is checked only where both sides are present: the assignability
 *     test lives in `packages/alchemy/tests/repo-shape-policy.test.ts`, which is the one
 *     place that imports both.
 */
import { renderCi } from './ci.ts';
import { renderActionlintConfig, renderChangesetConfig, renderDependabot } from './companions.ts';
import { renderSecurity } from './security.ts';
import type { RenderedPath, RepoShape } from './shape.ts';

/** The status-check contexts a rendered repository reports. */
export interface RepoShapePolicy {
  readonly owner: string;
  readonly repository: string;
  /**
   * ⛔ EXACTLY THE AGGREGATES, NEVER THE LEAF JOBS. `ci` is `if: always()` and fails when
   *   any job it needs did not succeed, so requiring it requires all of them. Requiring a
   *   leaf job instead would mean a ruleset edit every time a job is added, and a context
   *   that stops reporting leaves every pull request pending rather than failing.
   */
  readonly checks: readonly string[];
}

export interface RenderedRepo {
  /** Every rendered file, by its path relative to the repository root. */
  readonly files: Readonly<Record<string, string>>;
  /**
   * The options `declareRepoPolicy(id, { ...rendered.policy, settings })` takes.
   * Squash-only, auto-merge, delete-branch-on-merge and the `main` ruleset come from
   * there; the check names come from here.
   */
  readonly policy: RepoShapePolicy;
}

/**
 * Render a repository's tooling files and the policy that matches them.
 *
 *     const rendered = renderRepoShape(shape);
 *     rendered.files['.github/workflows/ci.yml']   // the file
 *     rendered.policy.checks                        // ['ci', 'secret scan']
 *
 * ⚠️ EXCEPTED FILES ARE STILL RENDERED. `files` is what the standard says this repository
 *   should have; `drift.ts` is what decides which of them are compared. Keeping them here
 *   means `--show` can print the standard version of an excepted file, which is how
 *   anyone judges whether the exception is still worth its reason.
 */
export function renderRepoShape(shape: RepoShape): RenderedRepo {
  const files: Record<string, string> = {
    '.changeset/config.json': renderChangesetConfig(shape),
    '.github/dependabot.yml': renderDependabot(shape),
    '.github/workflows/ci.yml': renderCi(shape),
    '.github/workflows/security.yml': renderSecurity(shape),
  };

  const actionlint = renderActionlintConfig(shape);
  if (actionlint !== undefined) files['.github/actionlint.yaml'] = actionlint;

  return {
    files,
    policy: { checks: ['ci', 'secret scan'], owner: shape.owner, repository: shape.repository },
  };
}

/** Every path this renderer can emit, whatever a given shape asks for. */
export const RENDERED_PATHS: readonly RenderedPath[] = [
  '.changeset/config.json',
  '.github/actionlint.yaml',
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/security.yml',
];
