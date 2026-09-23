/**
 * homeflare-kit's tooling, as one declaration.
 *
 * ★ WHY KIT ADOPTS ITS OWN RENDERER FROM SOURCE, NOT FROM THE TARBALL. Every other
 *   repository imports `@homeflare/config/repo-shape`, which resolves to the published
 *   `dist/`. Here that would be a lie twice over: `bun run types` runs before
 *   `bun run build` in this repo's `check`, so `dist/` is absent on a clean tree, and —
 *   more importantly — a change to the renderer would not be felt by kit's own files
 *   until the NEXT publish. Reading the source means a renderer change and the workflow
 *   files it re-renders land in the same pull request, and `bun run check` is what says
 *   so. The kit is the one repository where the source IS the dependency.
 *
 * ⛔ EDIT THIS FILE, NOT THE FILES IT RENDERS. `bun run repo-shape:refresh` rewrites
 *   .github/workflows/ci.yml, .github/workflows/security.yml, .github/dependabot.yml
 *   and .changeset/config.json from here; `tests/repo-shape.test.ts` fails
 *   `bun run check` on a hand edit before the refresh ever gets a chance to revert it.
 */
import { type RepoShape, extraJob, repoShapeCli } from './packages/config/src/repo-shape.ts';

export const shape: RepoShape = {
  owner: 'taslabs-net',
  repository: 'homeflare-kit',

  // ⚠️ THE ONE REPOSITORY STILL ON GITHUB-HOSTED RUNNERS, AND DELIBERATELY SO. The
  //   billing lock that pushed the estate onto `[self-hosted, homeflare-mini]` on
  //   2026-09-22 applies to private repositories; homeflare-kit is public, where
  //   GitHub-hosted minutes are free. It also keeps the package's own gate off the
  //   3-slot mini pool, so a kit release never queues behind the estate's pull requests.
  //   ⛔ THIS IS WHY `.github/actionlint.yaml` IS NOT RENDERED HERE: that file exists to
  //   declare the self-hosted runner label, and actionlint 1.7.12 treats an undeclared
  //   label as an ERROR. On ubuntu-latest there is no label to declare.
  runner: 'github',

  // ★ The only repository in the estate that ships npm tarballs. It sets `access: public`
  //   in the changeset config and drops the `privatePackages` block the other thirteen
  //   need, and it is why dependabot watches /packages/* as well as /.
  publishes: true,

  extraJobs: [
    extraJob({
      id: 'package',
      name: 'consumer smoke test',
      reason:
        'packs the real tarballs, installs them into a scratch project and typechecks from the consumer side under both bun and node — every other job here has passed on a package the estate could not consume (measured 2026-09-15, packages/kit/tests/dist.test.ts)',
      // ⛔ GATED ON `check`, NOT PARALLEL TO IT. This job builds a tarball; a formatting
      //   mistake should not have to wait on that to report.
      needs: ['check'],
      steps: [
        { run: 'bun run build' },
        { run: 'bun run smoke' },
        // ★ What a consumer would actually install, rendered onto the run's summary page.
        //   `if: always()` because a FAILED smoke test is exactly when the sizes are worth
        //   reading — that condition is the reason `JobStep` grew an `if` field.
        { if: 'always()', name: 'Job summary', run: 'bun run summary' },
      ],
    }),
  ],
};

if (import.meta.main) {
  process.exit(await repoShapeCli(import.meta.dir, shape, Bun.argv.slice(2)));
}
