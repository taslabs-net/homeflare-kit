# @homeflare/ui

## 0.2.0

### Minor Changes

- [#18](https://github.com/taslabs-net/homeflare-kit/pull/18) [`bcc6009`](https://github.com/taslabs-net/homeflare-kit/commit/bcc60097de5f9bdd6165f335bd15fa231422130a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Make the package ready for consistent Kumo adoption.

  **Breaking for anyone who installed 0.1.0** (nobody has — it exported only `VERSION`):
  `@cloudflare/kumo` moves from a dependency to a **peer**. Consumers import Kumo directly
  and granularly, so one copy must win; a dependency would let two versions coexist, meaning
  two stylesheets and two Base UI instances in one tree.

  - **`@homeflare/ui/styles`** — an opt-in CSS export: Kumo's stylesheet plus HomeFlare
    brand tokens (`--hf-radius-card`, `--hf-shell-max-width`, `--hf-gutter`). The JS
    entrypoint still imports no CSS, so a Worker or SSR pass can load this module safely.
  - **Kumo stays granular.** Nothing is wrapped or re-exported: import from
    `@cloudflare/kumo/components/*` as Kumo documents.
  - **Dropped `zod` and `echarts` as required peers** — Kumo marks both optional, so
    requiring them made every consumer install a chart library to render a Button.
  - **Corrected the entrypoint comment** that claimed Kumo was re-exported when it was not.
  - **README** with Next.js App Router and Vite/TanStack Start examples.
  - **Real smoke test**, replacing a script that echoed and exited 0. It packs the tarball,
    installs it beside Kumo, and proves JS resolution, the CSS export, consumer-side
    typechecking, and that a Kumo component renders to HTML.

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
