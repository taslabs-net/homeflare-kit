# Agent guidelines — homeflare-kit

This repo is the estate's shared packages. It is **standalone**: not a member of the
`homeflare/homeflare` pnpm workspace, and the golden `AGENTS.md` there does not govern it.
Where the two differ, the differences below are deliberate and stated with their reason.

## The packages

| package                 | holds                             | may import                          |
| ----------------------- | --------------------------------- | ----------------------------------- |
| `@homeflare/kit`        | env parsing, HTTP                 | nothing runtime-specific, ever      |
| `@homeflare/cloudflare` | Access JWT, structured logging    | workerd globals, `@homeflare/kit`   |
| `@homeflare/ui`         | React components                  | Kumo, React                         |
| `@homeflare/auth`       | Better Auth + Cloudflare adapter  | better-auth, drizzle (transitively) |
| `@homeflare/config`     | tsconfig / oxlint / oxfmt presets | — (no code)                         |

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

This repo is a **producer**. The monorepo and every app consume it from npm as an
ordinary dependency. That one fact settles most questions here:

- **Bun is the toolchain, not the runtime.** Bun installs, tests, builds and formats this
  code. Consumers run the published `dist/` on workerd, on Node, under pnpm — never under
  bun.
- **Prefer a known SDK to hand-rolling.** `ky` for HTTP (zero deps), `jose` for JWT,
  `zod` for validation, Kumo for UI. ⚠️ But weigh it: the logger here is ~50 lines and
  takes no dependency, because Workers Logs already parses `console.log` JSON natively —
  pino would add weight to reimplement what the platform does.
- ⛔ **The published entrypoint stays runtime-neutral.** Nothing in `src/index.ts` may
  import `bun:*`, `node:*` or touch a filesystem. Runtime-specific code goes behind its
  own subpath export (`@homeflare/kit/<area>`) so a consumer opts into it explicitly.
  ⚠️ The failure this prevents is a deploy-time one: a `bun:sqlite` import resolves fine
  on a laptop and fails only in workerd, where the trace names the bundler, not the file.

### The bun exception, stated rather than assumed

The monorepo's hard rule 7 is **pnpm only, estate-wide**, and calls `bun.lock` "a failed
install, not a peer". That rule is about the _workspace_: a second lockfile inside it
means two resolvers disagree about one dependency graph.

This repo is outside that workspace, so there is no graph to split. `bun.lock` here never
crosses into the monorepo — pnpm installs the published **tarball**, which contains no
lockfile at all. The rule stays intact; this is not an exception to it so much as a place
it does not reach.

## One version per package — the catalog

The root `package.json` holds a bun **catalog**: one entry per external dependency, for
the whole repo. Versions come from the estate's own `pnpm-workspace.yaml`, so the kit and
the monorepo cannot disagree about what "the house version" is.

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
| format               | `oxfmt` 0.68.0              | estate default — 16 of 90 monorepo packages, zero prettier                              |
| lint                 | `oxlint` 1.83.0             | same family, same config language                                                       |
| types                | `tsc` (TypeScript 7.0.2)    | ⚠️ the binary is `tsc`, **not** `tsgo` — that was the `@typescript/native-preview` name |
| build (JS)           | `bun build`                 | bundles `src/index.ts` to ESM                                                           |
| build (types)        | `tsc --emitDeclarationOnly` | ⛔ `bun build` **cannot** emit `.d.ts` — measured 2026-09-15, no such flag exists       |

★ **Why the build is two tools.** It would be one with `tsdown` or `tsup`, and the
monorepo uses neither (0 of 90 packages). Adding a bundler to avoid a second command
would import a dependency to solve a problem `tsc` already solves.

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
  `tests/workflows.test.ts`; no `yaml` dependency. Vitest wins in the monorepo (43 packages) because
  `@cloudflare/vitest-pool-workers` runs tests _inside_ workerd. This package has no
  Worker to run inside, so that reason does not apply here.

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
