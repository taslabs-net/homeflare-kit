# @homeflare/config

## 0.11.0

### Minor Changes

- [#170](https://github.com/taslabs-net/homeflare-kit/pull/170) [`ce7012c`](https://github.com/taslabs-net/homeflare-kit/commit/ce7012cf061eb6f7041e86675e14894868504a8c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The shared git hooks are active in every worktree, and pre-push is scoped to the push.

  - **pre-commit scans for secrets first** (`gitleaks git --staged`), then formats and
    lints the staged files as before. A missing `gitleaks` fails the commit with the
    install line instead of skipping.
  - **pre-push runs the repo's own `check`, narrowed**: lint and types run as `check`
    spells them, and each `bun test` becomes `bun test --changed=<base>`, so only the test
    files the pushed changes can reach run. `build*` and `smoke*` scripts are left to CI.
    The base comes from git's stdin: a second push is measured from what the remote has,
    and a new branch from where it left the default branch. A push that changes a manifest,
    lockfile, `bunfig.toml` or `tsconfig` runs the tests in full, and so does a push with no
    usable base. The run gets wider, never empty.
  - **New `activate` command, for `prepare`**:
    `"prepare": "bun node_modules/@homeflare/config/bin/hooks.ts activate"` sets
    `core.hooksPath=.husky`. That path is relative and tracked, so every worktree of the
    clone runs its own hooks, including a fresh `git worktree add`. husky's `.husky/_`
    existed only where husky had run. `activate` does nothing under `CI`.
  - **Adoption changes**: husky is no longer needed, and `problemsInHooks` now reports a
    `prepare` that does not activate, a `prepare` that still runs husky, and a wrapper
    that is not executable. The wrapper passes git's arguments through (`"$@"`), so
    re-run `install` to rewrite `.husky/pre-commit` and `.husky/pre-push`.
  - New exports: `activateHooks`, `planLanes`, `PREPARE`, and the `Lane` type.

## 0.10.0

### Minor Changes

- [#145](https://github.com/taslabs-net/homeflare-kit/pull/145) [`139379d`](https://github.com/taslabs-net/homeflare-kit/commit/139379de0628410e4382083e5406f390cc94e338) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `repo-shape` renders the path a kit release takes into a consumer. `.github/dependabot.yml` gains a `homeflare` group for `@homeflare/*`, first and taking every update type, and its bun block now runs daily with a `cooldown` that exempts `@homeflare/*` — Dependabot applies a 3-day cooldown even when none is configured, so without the exemption "daily" would have meant three days late. Third-party packages keep roughly their weekly pace through a 7-day cooldown, because Dependabot refuses two bun blocks over the same directory and so cannot give one group its own schedule. A new rendered workflow, `.github/workflows/dependabot-automerge.yml`, arms `gh pr merge --auto --squash` on that group's pull request and nothing else: no third-party action, no top-level permissions, `contents: write` and `pull-requests: write` on its one job, gated on Dependabot as both author and actor and on the group's exact branch name. It refuses, with a failed check and nothing armed, on a base branch whose rules require no status check: there `gh pr merge --auto` merges a CLEAN or UNSTABLE pull request at once instead of arming it. `docs/repo-shape-dependabot.md` cites each choice. ⚠️ The bun half does nothing yet: Dependabot's bundled bun reads `bun.lock` lockfileVersion 1 and every estate lockfile is 2, so it waits on dependabot/dependabot-core pull request 16071. Refresh with `bun run repo-shape:refresh` after bumping; the drift test fails until you do.

- [#127](https://github.com/taslabs-net/homeflare-kit/pull/127) [`a5b9b63`](https://github.com/taslabs-net/homeflare-kit/commit/a5b9b63cc23708e69ad17ed61a2e9cd020246f66) Thanks [@taslabs-net](https://github.com/taslabs-net)! - repo-shape: `node:` and a job `timeout:`, so the two repositories with a real Node
  requirement can take the standard instead of excepting out of it.

  Measured 2026-09-22: the mini's CI job image carries no `node` on `PATH` (ubuntu-latest
  always did). Two repositories had hand-written the identical `actions/setup-node@v6`
  block for two real reasons — homeflare-alerts' `tests/alchemy-import.test.ts` spawns
  `node` to prove the modules load the way the Alchemy CLI loads them, and homeflare-blog's
  Payload requires Node >= 24.15. Rendering without it would have forced both to
  `except({ file: '.github/workflows/ci.yml', … })`, handing the estate's two most
  complicated CI files straight back to hand-editing.

  `node: 24` renders `actions/setup-node@v6` with `package-manager-cache: false` ahead of
  `setup-bun`, in `check` and in every extra job that takes the bun prologue, and never in
  `workflow lint`, which installs nothing. `extraJob({ …, timeout: 15 })` renders
  `timeout-minutes:` for a job that starts something with its own wait — a browser that
  never paints holds a self-hosted slot for GitHub's 360-minute default rather than
  reporting red, and on a 3-slot pool that is the whole pool.

  Both are inputs, not exceptions: a repository that declares one keeps its drift check.

## 0.9.0

### Minor Changes

- [#143](https://github.com/taslabs-net/homeflare-kit/pull/143) [`d6520e7`](https://github.com/taslabs-net/homeflare-kit/commit/d6520e726fd443ed6aa07ad0cc33b8d0fa02175a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New export: `@homeflare/config/versions`, which publishes the estate's one aligned version
  set.

  `ESTATE_VERSIONS` pins `bun`, `alchemy`, `effect`, `@distilled.cloud/cloudflare`,
  `typescript`, `oxfmt`, `oxlint` and `@types/bun` to exact versions. Before this, Bun lived in
  `BUN_VERSION` and every other pin lived only in homeflare-kit's unpublished root catalog, so
  no other repository could compare its lockfile against anything. Measured read-only on
  2026-09-22, seven app repositories resolve `alchemy` beta.78, the monorepo resolves beta.77
  with `effect` rc.112, and one app resolves TypeScript 5.9.3.

  The kit's catalog stays the source. A new root test fails whenever a value here differs
  from the catalog, from the root `effect` override, from `packageManager`, from
  `BUN_VERSION`, or from the `@distilled.cloud/cloudflare` pin that the installed `alchemy`
  itself depends on. The runtime pins follow the pinned `alchemy` release (2.0.0-beta.79),
  so they move only in the PR that bumps it.

  This release enforces nothing in any consumer. Comparing each repository's lockfile in
  `checkProject` is a separate rollout. See `docs/versions.md`.

## 0.8.0

### Minor Changes

- [#125](https://github.com/taslabs-net/homeflare-kit/pull/125) [`bc3e1fa`](https://github.com/taslabs-net/homeflare-kit/commit/bc3e1fab090d58edfbabefd5731c54e5a450e14b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `JobStep` takes an `if:` condition, and homeflare-kit renders its own tooling from
  `repo-shape.ts`.

  The kit was the one repository the renderer had never been pointed at, and pointing it
  there found the gap immediately: kit's `consumer smoke test` ends with a step that prints
  the packed tarball sizes onto the run summary, and it carries `if: always()` because a
  FAILED smoke test is exactly when those sizes are worth reading. The two ways to adopt
  without this field were both worse — drop the condition and lose the summary on the only
  runs that need it, or `except('.github/workflows/ci.yml')` and lose the drift guarantee on
  the file for one repository's sake. Widening gives all fourteen the same freedom, which is
  the order of preference the module already documents.

  The emitter now writes `name:`, then `if:`, then the body, and the dash attaches to
  whichever of those comes first, so an unnamed unconditional step renders exactly as before
  (asserted by parsing the result, not by matching a substring).

  Adopting it in the kit also moved one guarantee to where it now lives: `tests/workflows.test.ts`
  read "build before test" out of ci.yml's step list, and the rendered job has one step —
  `bun run check`. That assertion now reads `package.json`'s `check` script, which is both
  where the ordering is decided and what a person runs locally, and a second test pins the
  ci job to exactly `bun install --frozen-lockfile` and `bun run check` so the lanes cannot
  quietly be copied back into the workflow.

  Rendering kit's files also picked up the estate fixes it had been missing:
  `gitleaks-action@v2` → `@v3` (GitHub removed the Node 20 runtime v2 needs), the absent
  `pull-requests: read` permission without which every pull-request secret scan fails 403,
  and the `@changesets/config` `$schema` pin at 4.0.1. Job names and the two required check
  contexts — `ci` and `secret scan` — are byte-identical to what ran before.

### Patch Changes

- [#137](https://github.com/taslabs-net/homeflare-kit/pull/137) [`1e7849e`](https://github.com/taslabs-net/homeflare-kit/commit/1e7849eedaac1efa565ab0315fa2be8bc8406647) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The rendered gitleaks note no longer says v2 fails outright. v2 declares `runs: node20`; GitHub removed that runtime from its hosted runner images on 2026-09-16, so v2 fails on `ubuntu-latest` and still runs on the mini's self-hosted runner. Moving to v3 drops a dependency on a runtime the platform has withdrawn, before any job moves back to a hosted runner. It is not repairing a scan that is currently broken.

  A repository that has adopted the shape goes red on `bun run check` until `bun run repo-shape:refresh` lands in the same pull request as the `@homeflare/config` bump.

- [#124](https://github.com/taslabs-net/homeflare-kit/pull/124) [`0c7885e`](https://github.com/taslabs-net/homeflare-kit/commit/0c7885eab9d58de16cb84b93bb31d57103841615) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Two defects in the hook layer, both measured the expensive way.

  🔴 **`pre-push` now strips the inherited `GIT_*` before running `bun run check`.** Git
  exports `GIT_DIR` and `GIT_INDEX_FILE` to a hook and everything it spawns inherits them;
  `check` runs the test suite, and a test that builds a throwaway git repository and
  commits in it commits into the repository being pushed instead — `cwd` is ignored once
  `GIT_DIR` is set. Measured 2026-09-22 at the cost of two junk files (`partial.ts`,
  `ugly.ts`, removed here) and a stray `Probe <probe@example.invalid>` commit reaching this
  repository's `main` through PR [#121](https://github.com/taslabs-net/homeflare-kit/issues/121). ⛔ The fix belongs in the hook, not in fourteen test
  suites: every repo in the estate is about to run its tests from `pre-push`, and
  `packages/site/tests/checkout.test.ts` already carried a comment warning about exactly
  this trap — which is how much a convention is worth.

  🔴 **Staged paths are read with `-z`.** Without it git applies `core.quotePath` and a
  file named `café .ts` comes back as the literal `"caf\303\251 .ts"` — quotes,
  backslashes, octal escapes. oxfmt is then handed a path that does not exist, every commit
  touching that file fails with a message about the wrong name, and the obvious response is
  `--no-verify`. Regression-tested with a non-ASCII, space-bearing filename.

  `packages/config/tests/hooks-gates.test.ts` is hardened the same way it should have been
  written: the scratch repository is a top-level `const` rather than a `let` a hook fills,
  every `git` call names it with `-C` and runs with `GIT_*` dropped, and the identity is
  passed with `-c` instead of a `git config` write that landed in the real repository.

  `scripts/hooks/verify.ts` — this repository's own pre-push, which runs the wider `verify`
  rather than `check` — gets the same treatment, because it is the one hook in the estate
  that does not go through the shared runner.

## 0.7.0

### Minor Changes

- [#121](https://github.com/taslabs-net/homeflare-kit/pull/121) [`b633606`](https://github.com/taslabs-net/homeflare-kit/commit/b633606483f3303ae18c34f18ed67a22e4356a6c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship the estate's git hooks from one place: `@homeflare/config/hooks` plus a
  `bin/hooks.ts` runner a repo's `.husky/` wrapper delegates to.

  `pre-commit` formats and lints only what is staged (sub-second), names the files it
  rewrote, and restages exactly those — a file with unstaged edits on top is checked and
  never rewritten, because restaging it would commit work in progress. `pre-push` runs the
  repo's own `bun run check`, never `verify`, which means a live adoption verifier in
  `homeflare-proxmox`. Both failures print the fix and the deliberate bypass.

  Adopt with `bun add -D @homeflare/config husky`, `"prepare": "husky"`, then
  `bun node_modules/@homeflare/config/bin/hooks.ts install`. `problemsInHooks()` reports
  drift; it is deliberately outside `checkProject` so repos that have not adopted stay
  green. ⚠️ A hook is a local convenience — skippable with `--no-verify`, absent until
  `bun install` — the required checks on `main` stay the gate.

  ★ **husky, not lefthook or a bare `core.hooksPath`** — it is already the estate's
  mechanism wherever hooks work, it installs from `prepare` on a plain `bun install`, and
  it keeps the hook files tracked and reviewable. A second mechanism alongside it would
  mean two ways to answer "are hooks on here".

  TRIGGER for folding this into `repo-shape`: the first repository commits a
  `repo-shape.ts` and a `repo-shape:refresh` script (none does today — measured
  2026-09-22, `repo-shape` shipped in [#112](https://github.com/taslabs-net/homeflare-kit/issues/112) and is adopted nowhere). At that point
  `HUSKY_HOOK` moves into `renderRepoShape().files`, `.husky/pre-commit` and
  `.husky/pre-push` join `RENDERED_PATHS`, and `problemsInHooks` is deleted in favour of
  `driftInRepoShape`. ⛔ Not before: routing hooks through `repo-shape` today would make
  every repo's hook adoption wait on a rewrite of its `ci.yml` and `security.yml`.

## 0.6.0

### Minor Changes

- [#112](https://github.com/taslabs-net/homeflare-kit/pull/112) [`b026f54`](https://github.com/taslabs-net/homeflare-kit/commit/b026f54fe4a79abe8eda85bd6709325661093fc4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `@homeflare/config/repo-shape`: the standard HomeFlare repository as one declaration.

  A repository declares `{ owner, repository, runner, publishes }` once and gets three
  things from it: its tooling **files** (`ci.yml`, `security.yml`, `actionlint.yaml`,
  `dependabot.yml`, `.changeset/config.json`), a **drift check** that fails when a committed
  file is not the rendered one, and its GitHub **settings** — `renderRepoShape(shape).policy`
  is the options object `@homeflare/alchemy`'s `declareRepoPolicy` takes, with the required
  check contexts derived from the workflows that report them.

  Measured across 13 estate repositories on 2026-09-22, the files this replaces had drifted
  in ways nobody chose: 5 security workflows still carried a `push: branches: [main]` the
  other 8 had dropped, 5 had no `concurrency:` block, 2 were missing `pull-requests: read`
  (without which every pull-request secret scan fails 403), the gitleaks action was pinned
  at `@v2` in 5 and `@v3` in 8, and 12 of 14 repositories had no Dependabot config at all.

  A deviation is declared or it fails. `except({ file, reason, since })` and
  `extraJob({ id, name, reason, steps })` refuse an empty reason _and_ a reason read from a
  variable — both collapse to `never`, so an exception without a written reason does not
  typecheck. See `packages/config/docs/repo-shape.md`.

## 0.5.1

### Patch Changes

- [#58](https://github.com/taslabs-net/homeflare-kit/pull/58) [`e7c101f`](https://github.com/taslabs-net/homeflare-kit/commit/e7c101faada2b14466a1f0bbf1f93da46e5e06cb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `tagExists` now ignores husky's `GIT_DIR`, so a pre-push verify cannot read this checkout's tags (or commit into it) from the throwaway release-gate repo.

## 0.5.0

### Minor Changes

- [#51](https://github.com/taslabs-net/homeflare-kit/pull/51) [`8c84cd9`](https://github.com/taslabs-net/homeflare-kit/commit/8c84cd91c9511a73c3a29b3e1cbe18e08ce35dd8) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `shouldRelease` and `require-release-config` so non-npm app repos share one GitHub-Release gate instead of copying the scripts. The guard also fails a leftover `pnpm-workspace.yaml` that hides the root package (measured 2026-09-17 on homeflare-secrets).

## 0.4.0

### Minor Changes

- [#38](https://github.com/taslabs-net/homeflare-kit/pull/38) [`6d04e88`](https://github.com/taslabs-net/homeflare-kit/commit/6d04e881725ae7364c0d42fef536735cbdbafb34) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Worker/TanStack apps can extend the toolchain without rewriting generated OpenAPI.

  **`oxlintrc.app.json`** — library oxlint with `--deny-warnings` failed on correct
  app code (measured 2026-09-16): `console.error` is Workers Logs, Alchemy/`Worker`
  entry files export default, tests use `!`, Kumo initials triggers fail
  `control-has-associated-label`. Apps extend this file, not the library preset.

  **oxfmt ignores merge.** `checkProject()` no longer requires a byte-identical
  `.oxfmtrc.json`. Extra `ignorePatterns` are allowed; dropping a house ignore or
  changing `singleQuote` is still drift. House ignores now cover `vendor/`,
  `**/generated/**`, `**/*.gen.ts`, and OpenAPI artefacts so a copy does not
  format generated files.

## 0.3.0

### Minor Changes

- [#35](https://github.com/taslabs-net/homeflare-kit/pull/35) [`88edb1a`](https://github.com/taslabs-net/homeflare-kit/commit/88edb1ad0f7916179e91f60c9c33f19ea8f00ffc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship `createD1AuthStorage` — D1 + schema in, `{ db, database }` out — and an app
  tsconfig for source-publishing deps.

  AnyAuth is the first consumer. It already runs official `better-auth` with
  `@better-auth/drizzle-adapter` on D1, and it blocked on `@homeflare/auth@0.1.5` because
  that tarball depended on `better-auth-cloudflare` and exported only `VERSION`.

  ⛔ This is a storage primitive, not a `createAuth()` factory. Plugins, hooks, schema,
  request-derived base URL, and `ExecutionContext` background tasks stay in the app.
  Wrapping `betterAuth()` here would freeze the wrong shape and erase plugin inference
  (better-auth#5047).

  ⛔ `better-auth-cloudflare` is gone. It is a community wrapper (zpg6), not Cloudflare.
  The wiring is `drizzle-orm/d1` + `@better-auth/drizzle-adapter`, which AnyAuth already
  uses. Server-only: import from `auth.ts`, never from `auth-client.ts`.

  **`tsconfig.app.json`** extends the strict baseline and turns off
  `exactOptionalPropertyTypes`, `noImplicitOverride` and `noUncheckedIndexedAccess`.
  `skipLibCheck` cannot help: `@cloudflare/ci@0.2.0` and Better Auth plugins publish
  `.ts`, so those flags fail the consumer. Owned packages still extend `base` / `lib`.

## 0.2.1

### Patch Changes

- [#31](https://github.com/taslabs-net/homeflare-kit/pull/31) [`093b704`](https://github.com/taslabs-net/homeflare-kit/commit/093b704860b8a0eba5b1690c8f2ab03b3bc3857c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Every package now has a smoke test that can actually fail.

  Three still had `echo` scripts — `cloudflare`, `config` and `auth` — the same pattern that
  let three defects ship in `@homeflare/alchemy@0.1.0`, each of which installed cleanly and
  threw at import.

  Each now packs the real tarball, installs it, and **uses** what it publishes:

  - **cloudflare** exercises the JWKS breaker, asserting a failing endpoint is fetched once
    rather than per call — the amplification guard, not just its export.
  - **config** extends `tsconfig.base.json` for real and runs `tsc`, so a broken extends
    fails here rather than in a consuming project, and resolves all five config files.
  - **auth** installs with its peers and imports `better-auth`, because a scaffold still has
    a contract: it must install and resolve.
  - **kit** is now bun-native — it used `npm pack`/`npm install`, predating the shared pack
    path. ⛔ It still runs the consumer under **node** as well as bun, deliberately: this
    package promises to be runtime-neutral, and testing only under bun would test the one
    runtime no consumer uses.

  `scripts/publish.ts` uses `bun pm view` for the registry check. ⚠️ `npm publish` stays,
  because `bun publish` has no `--provenance` flag.

## 0.2.0

### Minor Changes

- [#23](https://github.com/taslabs-net/homeflare-kit/pull/23) [`901f1ff`](https://github.com/taslabs-net/homeflare-kit/commit/901f1ff74da97ffcad138f3855aea9e1a861e583) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Make the config strong enough to scaffold a real project, and able to catch drift.

  **The preset was weaker than the estate it was meant to standardise.** It carried 4 rules
  and 4 plugins against the monorepo's 36 rules and 6 plugins — so adopting it would have
  been a downgrade. It now carries the full set, including `react` and `jsx-a11y`.

  ★ Adopting them immediately corrected three files in this repo (`sort-imports`,
  `prefer-template`), and this repo now lints itself **with its own preset** — a config the
  publisher does not obey is a config nothing proves.

  **New: `bunfig.toml`** — exact installs, cache on, coverage reported per project.

  **New: `@homeflare/config/check`** — a conformance check a project runs against itself:

  ```ts
  import { checkProject } from '@homeflare/config/check';
  expect(await checkProject(process.cwd())).toEqual([]);
  ```

  ⛔ `.oxfmtrc.json` and `bunfig.toml` have no `extends`, so adopting them means _copying_
  them — and a copy drifts silently. This reports what differs. It never repairs: it cannot
  tell drift from a deliberate local exception.

  ⚠️ Parses natively (`Bun.file().json()`, `Bun.TOML.parse`) with a string-aware JSONC strip,
  so no parsing dependency reaches a consumer — and a tsconfig keeps its comments, which is
  where the reasoning for a strict flag lives.

## 0.1.2

### Patch Changes

- [#21](https://github.com/taslabs-net/homeflare-kit/pull/21) [`3fb58ec`](https://github.com/taslabs-net/homeflare-kit/commit/3fb58ec85e259606f3919ee37e56816317edcd9e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship the real HomeFlare theme, and stop publishing broken commands.

  **The packaging defect (all five packages).** An installed `@homeflare/ui@0.2.0`
  advertised `bun run smoke`, which exited 1 with "Module not found scripts/smoke.ts" —
  `build` and `types` were equally broken, since `tsconfig.build.json` does not ship either.
  Dev scripts and devDependencies are now stripped at pack time, so the published manifest
  offers only what the tarball can run.

  ★ The pack path is now shared between the release and the smoke tests. When they differed,
  the gate inspected a different tarball from the one consumers received, which is exactly
  how this got out.

  **The theme.** `@homeflare/ui/styles` shipped stock Kumo — whose brand is **blue** —
  rather than HomeFlare orange. The theme now lives as data in `theme/homeflare.yaml`, with
  both the stylesheet and a new `@homeflare/ui/theme` module generated from it:

  ```ts
  import { ACCENT, ACCENT_INK } from '@homeflare/ui/theme';
  ```

  ⛔ `ACCENT_INK` is the contrast-safe text colour. `#f6821f` on a light background fails
  WCAG AA at body sizes, so orange text must never use the raw accent.

  ★ Why data and not just CSS: `#f6821f` is hardcoded in 37 files across the estate, and
  many are TSX — OG-image routes, admin widgets, email templates — which a stylesheet cannot
  reach. Parsed with `Bun.YAML.parse`, so no dependency is added.

  Also adds `@homeflare/ui/styles/tailwind` for apps that use Tailwind alongside Kumo.

## 0.1.1

### Patch Changes

- [#16](https://github.com/taslabs-net/homeflare-kit/pull/16) [`38cfc99`](https://github.com/taslabs-net/homeflare-kit/commit/38cfc99a7f38cbfe013eaa9d853dd0ca93a85b55) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship a README and LICENSE with every package.

  `@homeflare/cloudflare`, `/ui` and `/auth` declared both in `files` and had neither on
  disk, so their npm pages were blank and the tarballs carried no licence text. npm does
  not error on a missing `files` entry — it omits it — so every gate here stayed green.
  `@homeflare/config` never declared `LICENSE` at all.

  The `ui` and `auth` READMEs now say plainly that those packages are scaffolds exporting
  only `VERSION`, and `ui` documents using Kumo directly in the meantime. A bare npm page
  reads as "ready", which is the more expensive mistake.

## 0.1.0

### Minor Changes

- [`342d6f6`](https://github.com/taslabs-net/homeflare-kit/commit/342d6f6496b34735ae96ff31911133f6432e1c67) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Initial release of the HomeFlare shared packages.

  - **@homeflare/kit** — runtime-neutral primitives: `parseEnv` for typed, dependency-free
    environment parsing, and an HTTP client built on `ky` (zero dependencies, retries only
    idempotent methods).
  - **@homeflare/cloudflare** — Workers helpers: Access JWT verification via `jose` with a
    per-isolate JWKS cache, and structured logging that Workers Logs indexes natively.
  - **@homeflare/ui** — React components on Cloudflare Kumo.
  - **@homeflare/auth** — Better Auth with the Cloudflare adapter. Scaffold only: the
    dependencies resolve, the API waits for the first app that needs one.
  - **@homeflare/config** — the shared tsconfig, oxlint and oxfmt presets every HomeFlare
    project extends.

  Bun-native toolchain throughout, with the published output verified against both bun and
  node by a smoke test that installs the packed tarball.
