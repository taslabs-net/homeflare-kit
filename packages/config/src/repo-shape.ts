/**
 * `@homeflare/config/repo-shape` — the standard HomeFlare repository, as one declaration.
 *
 * A repository keeps a `repo-shape.ts` at its root:
 *
 *     import { except, repoShapeCli, type RepoShape } from '@homeflare/config/repo-shape';
 *
 *     export const shape: RepoShape = {
 *       owner: 'taslabs-net',
 *       repository: 'homeflare-proxmox',
 *       runner: 'mini',
 *       publishes: false,
 *     };
 *
 *     if (import.meta.main) process.exit(await repoShapeCli(import.meta.dir, shape, Bun.argv.slice(2)));
 *
 * That one file gives the repository:
 *
 *   · its FILES     — `bun run repo-shape:refresh` writes ci.yml, security.yml,
 *                     dependabot-automerge.yml, actionlint.yaml, dependabot.yml and
 *                     the changeset config;
 *   · its DRIFT GATE — a `bun:test` calling `driftInRepoShape` fails on a hand edit;
 *   · its SETTINGS  — `renderRepoShape(shape).policy` is the options object
 *                     `@homeflare/alchemy`'s `declareRepoPolicy` takes, so the ruleset
 *                     requires exactly the checks these workflows report.
 *
 * ⛔ A DEVIATION IS DECLARED OR IT FAILS. `except({ file, reason, since })` refuses an
 *   empty reason and refuses a reason read from a variable — the text has to be written
 *   at the exception, in the diff, where someone will read it. Same for `extraJob()`.
 *
 * ★ WHY IT LIVES IN `@homeflare/config` RATHER THAN `@homeflare/alchemy`. Measured
 *   2026-09-22: `@homeflare/config` is a dependency of 13 of 14 estate repositories and
 *   `@homeflare/alchemy` of 4. The drift check has to run in every repository's own CI,
 *   including the ones with no Alchemy stack, so it belongs to the package they all
 *   already have — and it takes no dependency on Alchemy or Effect to get there.
 */
export { GROUP_BRANCH, GROUP_BRANCH_PREFIX, renderAutomerge } from './repo-shape/automerge.ts';
export { renderCi, ACTIONLINT_VERSION, BUN_VERSION } from './repo-shape/ci.ts';
export { renderActionlintConfig, renderChangesetConfig } from './repo-shape/companions.ts';
export {
  HOMEFLARE_GROUP,
  HOMEFLARE_PATTERN,
  renderDependabot,
  THIRD_PARTY_COOLDOWN_DAYS,
} from './repo-shape/dependabot.ts';
export {
  type DriftReport,
  type Problem,
  driftInRepoShape,
  exceptionSummary,
  REFRESH_COMMAND,
} from './repo-shape/drift.ts';
export { type RefreshResult, refreshRepoShape, repoShapeCli } from './repo-shape/refresh.ts';
export {
  type RenderedRepo,
  type RepoShapePolicy,
  RENDERED_PATHS,
  renderRepoShape,
} from './repo-shape/render.ts';
export { renderSecurity } from './repo-shape/security.ts';
export {
  type ExtraJob,
  type JobStep,
  type RenderedPath,
  type RepoRunner,
  type RepoShape,
  type RepoShapeException,
  type Stated,
  except,
  extraJob,
  isExcepted,
  runsOn,
} from './repo-shape/shape.ts';
