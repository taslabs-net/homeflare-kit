# @homeflare/config

The HomeFlare toolchain, as configuration. One place to change a rule, rather than one
copy per repo that drifts.

```sh
bun add -D @homeflare/config
```

## What it gives you

| file                 | how to use it                                             |
| -------------------- | --------------------------------------------------------- |
| `tsconfig.base.json` | `extends` — owned code, full strictness                   |
| `tsconfig.app.json`  | `extends` — Worker apps (source-publishing deps)          |
| `tsconfig.lib.json`  | `extends` — packages that publish types                   |
| `oxlintrc.json`      | `extends` — libraries                                     |
| `oxlintrc.app.json`  | `extends` — Worker / TanStack / Alchemy apps              |
| `oxfmtrc.json`       | copy to `.oxfmtrc.json`                                   |
| `bunfig.toml`        | copy to `bunfig.toml`                                     |
| `./versions`         | `import` — [the estate's version set](./docs/versions.md) |

## tsconfig

```jsonc
// a Worker or app that imports packages publishing .ts (not .d.ts)
{ "extends": "@homeflare/config/tsconfig.app.json" }

// owned library code — the full baseline
{ "extends": "@homeflare/config/tsconfig.base.json" }

// a package that publishes types
{ "extends": "@homeflare/config/tsconfig.lib.json" }
```

`tsconfig.lib.json` adds `isolatedDeclarations` and `declaration`. ⛔ Both are needed
together — `isolatedDeclarations` alone is TS5069, even under `--noEmit`.

The base turns on `strict` plus the flags that catch the most runtime bugs:
`noUncheckedIndexedAccess` (`arr[0]` is `T | undefined`), `exactOptionalPropertyTypes`,
and `noFallthroughCasesInSwitch`.

⚠️ **`tsconfig.app.json` turns three of those off.** `skipLibCheck` only skips `.d.ts`.
Measured 2026-09-16: `@cloudflare/ci@0.2.0` ships `"types": "./src/index.ts"`, and Better
Auth plugin types do the same. Those files typecheck under _your_ flags, so the strict
baseline fails the consumer. Use the app preset there; keep `base` / `lib` for code you
own. Override the flags back on in a project that does not import source-publishing deps.

## oxlint

```json
{ "extends": ["./node_modules/@homeflare/config/oxlintrc.json"] }
```

A Worker, TanStack Start, or Alchemy app:

```json
{ "extends": ["./node_modules/@homeflare/config/oxlintrc.app.json"] }
```

⚠️ oxlint's `extends` takes **file paths**, not package names — there is no
`eslint-config-*` style resolution, so the path into `node_modules` is written out.

The library preset is 36 rules across `typescript`, `unicorn`, `oxc`, `import`, `react`
and `jsx-a11y`. The app preset extends it and turns off the collisions `--deny-warnings`
hits on correct Worker/app code (measured 2026-09-16):

- `no-console` off under `src/` — `console` _is_ Workers Logs.
- `import/no-default-export` off — Alchemy, `Worker`, and TanStack entry files export
  default.
- `jsx-a11y/control-has-associated-label` off — Kumo initials triggers are labelled by
  the design system, not a `htmlFor`.
- `typescript/no-non-null-assertion` off in tests.

⛔ Do not copy the library preset into an app and then disable those one by one. That is
how every app grows a private oxlint.

## oxfmt and bunfig

```sh
cp node_modules/@homeflare/config/oxfmtrc.json .oxfmtrc.json
cp node_modules/@homeflare/config/bunfig.toml  bunfig.toml
```

⚠️ `.oxfmtrc.json` needs the **leading dot**. Without it oxfmt silently uses its defaults,
and the symptom is a formatter that rewrites your quotes.

⛔ oxfmt has no `extends`. Extra `ignorePatterns` are a **merge**: generated OpenAPI,
`vendor/`, `**/generated/**`, `**/*.gen.ts` stay out of the formatter. ⛔ Identity
comparison is the wrong gate — it rewrote 154 files to `singleQuote` and formatted
vendor OpenAPI (measured 2026-09-16). Dropping a house ignore is still drift.

`bunfig.toml` is still an exact copy.

## Keeping a project honest

```ts
import { checkProject } from '@homeflare/config/check';

const problems = await checkProject(process.cwd());
if (problems.length > 0) throw new Error(problems.join('\n'));
```

★ Run it from a test. It asserts a project still extends the shared tsconfig and oxlint
presets, that `.oxfmtrc.json` keeps house style plus at least the house ignores, and that
`bunfig.toml` still matches.

## App releases (no npm)

A HomeFlare app that does **not** publish a tarball still versions itself with Changesets
and cuts a GitHub Release. It does not call `npm publish`.

```ts
import { runAppRelease } from '@homeflare/config/release';

await runAppRelease(process.cwd());
```

`shouldRelease` proceeds only when `CHANGELOG.md` has `## <version>` (proof
`changeset version` ran) AND no git tag `<name>@<version>` exists yet. A custom
`publish-script` on changesets/action otherwise tags every changeset-less push to `main`
(measured 2026-09-16/17; changesets/action#9).

```ts
import { runRequireReleaseConfig } from '@homeflare/config/require-release-config';

await runRequireReleaseConfig();
```

⛔ A private `package.json` without `privatePackages.version: true` makes
`changeset version` silently no-op. The guard fails that combination before the version
command consumes the changeset file.

⛔ A leftover `pnpm-workspace.yaml` that lists only nested packages hides the root.
Measured 2026-09-17 on `homeflare-secrets`: `changeset version` exited 1 ("package
homeflare-secrets which is not in the workspace") and no Version Packages PR opened.
The workspace file must include `.` if it exists at all.

⛔ Both helpers take the **app** cwd / paths. Defaulting from `import.meta.url` after
publish would inspect `@homeflare/config` itself.

Alchemy still owns `GitHub.Repository` (visibility, `deleteBranchOnMerge`, `hasWiki`) and
`Cloudflare.state()`. The kit `main` ruleset is `scripts/apply-main-ruleset.ts`, not an
Alchemy resource — see `docs/github-hygiene.md`.

## git hooks

One hook layer for the whole estate: a secret scan and staged format/lint on commit, and
the repo's own `check` narrowed to what a push can affect on push. They are active in
every worktree of a clone. Adoption, what runs, and why:
[docs/hooks.md](./docs/hooks.md).

```sh
bun node_modules/@homeflare/config/bin/hooks.ts install     # then "prepare": "bun node_modules/@homeflare/config/bin/hooks.ts activate"
```

## License

MIT © Timothy Schneider
