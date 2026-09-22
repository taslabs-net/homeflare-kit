# Every input a repository declares, and what it renders

`RepoShape` is the whole declaration. This is the field reference; the model —
why a difference is an input or an exception and never a hand edit — is in
[repo-shape.md](./repo-shape.md).

## The fields

| Field        | Renders                                                                                                      | Measured reason it is an input                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `owner`      | The `repo:` in `.changeset/config.json`                                                                      | The only text that varied in that file across 11 of 13 repositories                              |
| `repository` | The same, plus the Dependabot target                                                                         | As above                                                                                         |
| `runner`     | `runs-on:` in every job, whether `.github/actionlint.yaml` exists, and the header's billing note             | 12 repositories on the mini, 1 (`homeflare-kit`) on `ubuntu-latest`. One variable, three files   |
| `publishes`  | `access: public\|restricted`, whether `privatePackages` is written, whether Dependabot watches `/packages/*` | `@changesets/cli` versions **nothing** when `privatePackages.version` is absent — a silent no-op |
| `node`       | `actions/setup-node@v6` before `setup-bun`, in `check` and every bun extra job                               | See below                                                                                        |
| `extraJobs`  | One job per entry, its stated reason above it, and its id in the `ci` aggregate's `needs`                    | 4 genuinely different jobs across 3 repositories                                                 |
| `exceptions` | Nothing — it removes a file from the drift comparison                                                        | The escape hatch, priced so it is used last                                                      |

## `node` — the input added 2026-09-22

⛔ **The mini's job image carries no node at all.** `ubuntu-latest` always did, so a
Bun-only prologue is right for twelve repositories and _silently wrong_ for two:

- **homeflare-alerts** — `tests/alchemy-import.test.ts` spawns `node` to prove the modules
  load the way the Alchemy CLI (`node …/cli.js`) loads them. Without a real node, three
  tests fail with `Executable not found in $PATH: "node"`, measured on the runner.
- **homeflare-blog** — Payload requires Node >= 24.15, so every lane needs it.

Both had written the identical `actions/setup-node@v6` block by hand before this existed.
The alternative was `except({ file: '.github/workflows/ci.yml', … })` in both — which
would have handed the estate's two most complicated CI files back to hand-editing, in the
round whose whole purpose was to stop that.

```ts
export const shape: RepoShape = {
  owner: 'taslabs-net',
  repository: 'homeflare-alerts',
  runner: 'mini',
  publishes: false,
  node: 24, // a major, not a range: setup-node resolves the newest 24.x
};
```

⚠️ `package-manager-cache: false` is rendered with it. Bun does the installing, so priming
npm's cache costs time and caches nothing anything in the job reads.

★ **`workflow lint` never gets it.** That job installs nothing — actionlint is preloaded
on the image — so adding node there would pay for a toolchain no step uses.

## `timeout` on an extra job

`extraJob({ …, timeout: 15 })` renders `timeout-minutes: 15`.

⚠️ **A hung job is not a failed job.** homeflare-blog's `runtime` job drives Playwright
against a local workerd; a browser that never reaches its first paint holds a self-hosted
slot for GitHub's default 360 minutes rather than reporting red, and on a 3-slot pool that
is the whole pool. Only a job that starts something with its own wait — a browser, a
server, a container — needs one. `check` does not: `bun run check` exits.

## What the renderer owns, and what it does not

The rendered `check` job runs one step: `bun run check`, the repository's own gate.

That is deliberate. A workflow that re-lists `lint`, `types` and `test` is a second copy
of the gate, and a copy can check _less_ than the original. Measured 2026-09-22:
`bun run check` in `homeflare-kit` is `lint && types && build && test`, and its
`tests/dist.test.ts` skips itself when `dist/` is absent — so a workflow that ran the
three lanes without the build would drop that test silently and still report green.
`homeflare-alerts` runs `check:types` and `build:web` in its check; `homeflare-subnet-calc`
delegates to `verify`. All fourteen have a `check` script, and all fourteen are local-only.

So the split is:

| Owned by the renderer                            | Owned by the repository                    |
| ------------------------------------------------ | ------------------------------------------ |
| Triggers, permissions, concurrency, runner label | What `bun run check` runs                  |
| Action versions and their pins                   | Which extra jobs exist, each with a reason |
| The aggregate `ci` job and its `needs`           | Its `package.json` scripts                 |
| The actionlint, Dependabot and changeset configs | —                                          |

The cost, said plainly: a red X says `check` rather than naming the lane. `bun run check`
short-circuits on the first failure and names the lane in its output, which is the same
signal a person gets locally.
