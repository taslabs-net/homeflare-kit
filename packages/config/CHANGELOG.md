# @homeflare/config

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
