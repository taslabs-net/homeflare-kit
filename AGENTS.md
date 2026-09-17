# Agent guidelines — homeflare-kit

A bun workspace publishing shared packages to npm. It is a **producer**: consuming
applications install the published tarballs, so every decision here is judged by what a
consumer receives, not by what is convenient in this tree.

**Read only what your task needs:**

| doing                                  | read                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------- |
| adding or changing package code        | [The packages](#the-packages) · [What this repo is](#what-this-repo-is) |
| adding a dependency                    | [One version per package](#one-version-per-packagethe-catalog)          |
| touching the build, lint or types      | [Toolchain](#toolchain) · [Bun-native](#bun-native-not-library-native)  |
| anything that publishes                | [docs/releasing.md](./docs/releasing.md)                                |
| opening a PR                           | [CONTRIBUTING.md](./CONTRIBUTING.md)                                    |
| **consuming these packages elsewhere** | [llms.txt](./llms.txt) — not this file                                  |

⛔ Comments in the source carry measured facts and the incidents behind them. When a rule
here seems arbitrary, the comment at the code says what it cost to learn. Do not delete
them to fit a line limit — extract into a new file instead.

## The packages

| package                 | holds                             | may import                        |
| ----------------------- | --------------------------------- | --------------------------------- |
| `@homeflare/kit`        | env parsing, HTTP                 | nothing runtime-specific, ever    |
| `@homeflare/cloudflare` | Access JWT, structured logging    | workerd globals, `@homeflare/kit` |
| `@homeflare/ui`         | React components                  | Kumo, React                       |
| `@homeflare/auth`       | Better Auth D1 storage            | drizzle-orm, official adapter     |
| `@homeflare/typesafe`   | TypeSafe System One client        | `@typesafe-ai/sdk` (official)     |
| `@homeflare/config`     | tsconfig / oxlint / oxfmt presets | — (no code)                       |

⚠️ **TWO KINDS OF AUTH, NOT INTERCHANGEABLE.** `@homeflare/cloudflare` verifies a
Cloudflare Access assertion — the edge already authenticated the caller and you check its
signature (jose, stateless). `@homeflare/auth` is Better Auth, where YOU are the identity
provider: sessions, accounts, a database. Reaching for the wrong one produces a system
that looks authenticated and is not.

⛔ **The split is the point.** A Node script depending on `@homeflare/kit` must not drag
Workers types or React into its resolution. When in doubt about where something goes, ask
whether it would still make sense in a plain Node process; if not, it is not kit code.

★ **Kumo is the design system** ([cloudflare/kumo](https://github.com/cloudflare/kumo)) —
44 accessible components on Base UI, with its own stylesheet. ⛔ shadcn/Radix are
deliberately absent: Kumo occupies that layer already, and taking both would mean two
primitive libraries and two a11y models in one app.

## What this repo is

Consumers install these packages from npm as ordinary dependencies, with whatever
package manager they use. That one fact settles most questions here:

- **Bun is the toolchain, not the runtime.** Bun installs, tests, builds and formats this
  code. Consumers run the published `dist/` on workerd, on Node, under pnpm — never under
  bun.
- **Prefer a known SDK to hand-rolling.** `ky` for HTTP (zero deps), `jose` for JWT,
  `zod` for validation, Kumo for UI, `@typesafe-ai/sdk` for System One judgments. ⚠️ But weigh it: the logger here is ~50 lines and
  takes no dependency, because Workers Logs already parses `console.log` JSON natively —
  pino would add weight to reimplement what the platform does.
- ⛔ **The published entrypoint stays runtime-neutral.** Nothing in `src/index.ts` may
  import `bun:*`, `node:*` or touch a filesystem. Runtime-specific code goes behind its
  own subpath export (`@homeflare/kit/<area>`) so a consumer opts into it explicitly.
  ⚠️ The failure this prevents is a deploy-time one: a `bun:sqlite` import resolves fine
  on a laptop and fails only in workerd, where the trace names the bundler, not the file.

## One version per package — the catalog

The root `package.json` holds a bun **catalog**: one entry per external dependency, for
the whole repo — so two packages can never resolve the same dependency at different
versions, which is the drift a catalog exists to prevent.

⛔ **Only `devDependencies` may say `catalog:`.** Measured 2026-09-15: `npm pack` leaves
the string `catalog:` untouched — only `bun pm pack` resolves it — and `changeset publish`
shells out to npm. A catalogued RUNTIME dependency therefore publishes as the literal
`"catalog:"`, and every consumer install dies with `EUNSUPPORTEDPROTOCOL`.
(Changesets' catalog support is changesets/changesets#2213, still open.)

⚠️ **Nothing but the smoke test caught this.** bun installed the workspace happily, lint,
types and tests were all green, and the failure appeared only when the tarball was packed
with npm and installed. `tests/catalog.test.ts` now asserts it directly.

★ So published `dependencies` carry literal versions, and a test asserts each one MATCHES
its catalog entry — the catalog stays authoritative, and drift is a failing test rather
than a judgement call.

⛔ **Peer ranges stay ranges, never `catalog:`.** A catalogued peer publishes as the
catalog's exact version (`react: "19.3.0"` rather than `^18 || ^19`), which rejects every
consumer on any other React for no reason. The catalog pins what WE install; a peer
declares what a consumer may bring.

## Toolchain

| concern              | tool                        | why                                                                                     |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| install / run / test | `bun` 1.4.0                 | one tool, no node setup step in CI                                                      |
| format               | `oxfmt` 0.68.0              | fast, and the same config language as oxlint                                            |
| lint                 | `oxlint` 1.83.0             | same family, same config language                                                       |
| types                | `tsc` (TypeScript 7.0.2)    | ⚠️ the binary is `tsc`, **not** `tsgo` — that was the `@typescript/native-preview` name |
| build (JS)           | `bun build`                 | bundles `src/index.ts` to ESM                                                           |
| build (types)        | `tsc --emitDeclarationOnly` | ⛔ `bun build` **cannot** emit `.d.ts` — measured 2026-09-15, no such flag exists       |

★ **Why the build is two tools.** It would be one with `tsdown` or `tsup`. Adding a
bundler to avoid a second command would import a dependency to solve a problem `tsc`
already solves.

★ **`isolatedDeclarations` is on**, which is what makes that split safe: every exported
symbol carries an explicit type, so the `.d.ts` cannot drift from the `.js` beside it.
⚠️ It cannot be set without `declaration`, even under `--noEmit` (TS5069), so both flags
appear in `tsconfig.json` while emit stays off.

## Bun-native, not library-native

Bun parses these itself. Do not add a dependency for any of them:

- **YAML** — `Bun.YAML.parse()`, or `import cfg from './x.yaml'` directly
- **TOML** — `Bun.TOML`, and `bunfig.toml` is read natively
- **JSON / JSONC** — `await Bun.file(p).json()`
- **SQLite** — `bun:sqlite` (⛔ subpath export only, never the main entry)
- **tests** — `bun:test`, not vitest. `Bun.YAML.parse` reads the workflow files in
  `tests/workflows.test.ts`; no `yaml` dependency.
  ⚠️ Vitest is the right choice for a package that ships a Worker, because
  `@cloudflare/vitest-pool-workers` runs the tests _inside_ workerd. Nothing here ships a
  Worker, so that reason does not apply.

## Releasing

Tag-free: changesets opens a "Version Packages" PR, and merging it publishes.

⛔ **Publishing does NOT use `changeset publish`** — it would ship `workspace:*` and
`catalog:` literally and break every consumer install. See
[docs/releasing.md](./docs/releasing.md) for that, the GitHub Actions rules, and the
measured evidence behind both.

## Git

- `origin` is **GitHub** (`taslabs-net/homeflare-kit`). It is the only remote.
- Forgejo (`git.homeflare.dev/tim/homeflare-kit`) is a **pull mirror** of GitHub, and is
  read-only. ⚠️ It was a push mirror until 2026-09-15 and the direction was reversed
  because Alchemy has first-class GitHub resources and none for Forgejo — and because
  Forgejo push mirrors carry git data only, never releases (forgejo#4701, open).
- ⛔ Never commit on the Forgejo side. A pull mirror overwrites, so the work would vanish
  at the next sync with nothing to say it existed.

## Smoke testing — the gate that actually matters

⛔ **`bun run smoke` is not optional and runs in CI.** It packs the real tarball, installs
it into a scratch project, and uses it under **both bun and node**, typechecking from the
consumer's side with `skipLibCheck: false`.

⚠️ **THE FAILURE THIS CAUGHT, MEASURED 2026-09-15.** `"sideEffects": false` in
package.json made `bun build` emit a **126-byte** `dist/index.js` containing only
`export { EnvError, VERSION, parseEnv }` — the export _names_, with every module body
tree-shaken away. It bundled without error, `bun test` passed (tests import `src/`), and
`tsc` emitted correct `.d.ts`. **Every gate was green and the tarball was unusable.**
The field is now absent, and `tests/dist.test.ts` imports `dist/` so it cannot recur.

★ Two layers, because they catch different things: `tests/dist.test.ts` imports the built
file by path, `scripts/smoke.ts` goes through npm resolution — which is the only way to
catch a missing `files` entry, an `exports` gap, or a dev-only dependency imported at
runtime. Those land in the CONSUMING repo days later and read as that repo's bug.

⛔ `bun run build` MUST precede `bun test`. The dist guard skips itself when `dist/` is
absent, so the wrong order silently drops it.

## House rules that DO apply here

- **File length: code ≤250 lines, documents ≤200.** Over the cap you EXTRACT into a file
  that does one thing. ⛔ You do not delete comments to fit — the comments are the
  expensive part.
- **Comments are the product.** `⛔` a rule and what breaks if broken · `⚠️` a trap and
  the SYMPTOM it produces · `★` why a choice was made over the obvious alternative.
  A date and the word "measured" beat an assertion.
- **No secret values, ever.** This is a public package. Nothing reads a credential here.
