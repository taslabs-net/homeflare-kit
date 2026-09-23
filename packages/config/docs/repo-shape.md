# The standard repo shape, and how to except from it

A HomeFlare repository declares its tooling once. The declaration renders the files, and
the same declaration hands `@homeflare/alchemy`'s `declareRepoPolicy` the GitHub settings
and the ruleset. "Standard repo" is one object, not fourteen copies of five files.

## Why

Measured across the estate on 2026-09-22, before any of this existed:

| File                             | Copies | What differed, and whether it was a decision                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.changeset/config.json`         | 13     | Identical apart from the repo name in 11. Of the 3 that differed: 2 pinned an older `$schema`, 1 used the built-in changelog so its releases carry no PR links. **None deliberate.**                                                                                                                                                                                  |
| `.github/workflows/security.yml` | 13     | 5 still had `push: branches: [main]`; 5 had no `concurrency:` at all; 2 lacked `pull-requests: read`, whose absence makes every PR scan fail 403; the gitleaks action was `@v2` in 5 and `@v3` in 8 (v2's `node20` runtime is gone from hosted images since 2026-09-16 and still present on the mini); the weekly cron took 3 different minutes. **None deliberate.** |
| `.github/workflows/ci.yml`       | 13     | Two shapes (`lint`/`types`/`test` split in 6, one `check` job in 7), one repo still on `ubuntu-latest`, and four wordings of the same header comment. The genuinely different parts were four extra jobs across three repos.                                                                                                                                          |
| `.github/actionlint.yaml`        | 12     | Three wordings of one comment. The repo without it is the one on GitHub-hosted runners, which is the only case where it is not needed.                                                                                                                                                                                                                                |
| `.github/dependabot.yml`         | 1      | Twelve repositories took no dependency or Action updates at all, and nothing said so.                                                                                                                                                                                                                                                                                 |

Every one of those rows is the same edit applied by hand a dozen times, landing in a
different subset each time. A renderer makes it one edit.

## Declaring a repository

`repo-shape.ts` at the repository root:

```ts
import { repoShapeCli, type RepoShape } from '@homeflare/config/repo-shape';

export const shape: RepoShape = {
  owner: 'taslabs-net',
  repository: 'homeflare-proxmox',
  runner: 'mini', // '[self-hosted, homeflare-mini]' — or 'github' for ubuntu-latest
  publishes: false, // true only for a repository that ships an npm tarball
};

if (import.meta.main) {
  process.exit(await repoShapeCli(import.meta.dir, shape, Bun.argv.slice(2)));
}
```

`package.json`:

```json
{
  "scripts": {
    "repo-shape:refresh": "bun run repo-shape.ts"
  }
}
```

`tests/repo-shape.test.ts` — this is the gate:

```ts
import { expect, test } from 'bun:test';
import { driftInRepoShape } from '@homeflare/config/repo-shape';
import { shape } from '../repo-shape.ts';

test('the tooling files are the ones @homeflare/config renders', async () => {
  const report = await driftInRepoShape(import.meta.dir + '/..', shape);
  expect(report.problems).toEqual([]);
});
```

Then `bun run repo-shape:refresh` once, commit what it writes, and `bun run check` is the
drift check from then on.

### The GitHub half

In `alchemy.run.ts`, the same declaration:

```ts
import { renderRepoShape } from '@homeflare/config/repo-shape';
import { declareRepoPolicy } from '@homeflare/alchemy/github';
import { shape } from './repo-shape.ts';

export default Effect.gen(function* () {
  yield* declareRepoPolicy('repo', {
    ...renderRepoShape(shape).policy,
    settings: { description: '…', visibility: 'private' },
  });
});
```

`policy.checks` is derived from the rendered workflows, so the ruleset cannot require a
context no job reports. That failure mode has no error message: a required check that
never reports stays _pending_, and with auto-merge armed the pull request waits forever.

## Excepting

Two kinds of deviation, and they are not the same thing.

**An extra job** is work this repository genuinely has and others do not — a frontend
build, a Go toolchain, a consumer smoke test. It is not an exception to the standard; it
is an addition the standard supports:

```ts
extraJobs: [
  extraJob({
    id: 'build',
    name: 'build',
    reason: 'ships a Vite frontend the Worker serves; no other estate repository does',
    steps: [{ run: 'bun run build:web' }],
  }),
],
```

The job's name joins the `ci` aggregate's `needs`, so it is required without anyone
touching a ruleset, and the reason is rendered into the workflow above the job.

**An exception** is a rendered file this repository keeps its own copy of:

```ts
exceptions: [
  except({
    file: '.github/workflows/ci.yml',
    reason: 'Payload needs Node >=24.15, which the rendered job does not install',
    since: '2026-09-22',
  }),
],
```

The drift check then stops comparing that file. That is the trade, and it is a real cost:
the repository buys the freedom to hand-edit one file and pays for it by losing the
guarantee on that file forever. **Prefer widening `RepoShape`** — then every repository
gets the fix and nothing is given up.

### A reason is enforced by the compiler

`except()` and `extraJob()` refuse an empty reason _and_ a reason read out of a variable.
Both collapse to `never`, so neither compiles:

```ts
except({ file: '.github/workflows/ci.yml', reason: '', since: '2026-09-22' }); // ✗
except({ file: '.github/workflows/ci.yml', reason: whyVariable, since: '2026-09-22' }); // ✗
```

The text has to be written at the call, in the diff, where someone reviewing will read it.
A reason assembled at runtime is a reason nobody reads.
`packages/config/tests/repo-shape-reason.test.ts` runs `tsc` over a fixture of exactly
these calls and asserts they still fail, so a TypeScript upgrade that made one legal turns
the suite red rather than quietly opening the door.

Three further things the check refuses, each because it hides a reason:

- an exception for a file this shape does not render — stale, and the exception list is
  supposed to be the one honest inventory of deviations;
- the same file excepted twice — one of the two reasons would never be read;
- a blank or one-word reason — the type allows `'   '` because it is a non-empty literal,
  so a runtime guard catches that half.

## What the renderer owns, and what it does not

The rendered `check` job runs one step: `bun run check`, the repository's own gate — so
the renderer owns the plumbing and the repository owns what its gate runs. That split,
and every field of `RepoShape` with the measurement behind it, is in
[repo-shape-inputs.md](./repo-shape-inputs.md).

## Bumping `@homeflare/config` will go red before it goes green

⚠️ **This is the price of the check, and it is worth knowing before it happens.** When the
renderer changes — a new action version, a fixed permission — every repository that bumps
`@homeflare/config` fails `bun run check` on the next run, because its committed files are
now the _old_ render. That includes the Dependabot pull request that does the bumping,
which cannot fix itself ([repo-shape-dependabot.md](repo-shape-dependabot.md) says why).

The fix is one command, and the failure names it. The rule that follows:

> **A `@homeflare/config` bump and a `bun run repo-shape:refresh` land in the same pull
> request.** Never merge the bump alone, and never refresh without saying which version
> of the renderer produced the files.

The alternative — a check that tolerated an older render — is a check that tolerates
drift, which is the thing this exists to stop. A loud, one-command failure is the better
half of that trade, but it is a trade.

## What this does not render yet

`.github/workflows/release.yml`. Thirteen copies, 166–197 lines each, thirteen distinct
hashes — publishing to npm, tagging a GitHub Release, and running `changeset version`
differ enough between them that rendering it needs its own measurement pass rather than
being folded into this one. It is the next file, not a file that was decided against.
