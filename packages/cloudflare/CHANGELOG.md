# @homeflare/cloudflare

## 0.3.0

### Minor Changes

- [#32](https://github.com/taslabs-net/homeflare-kit/pull/32) [`5cc2cd6`](https://github.com/taslabs-net/homeflare-kit/commit/5cc2cd62241f926aace1646fd3a1e0057e96cddd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `accessIdentity` (ctx.access) and RFC 9728 MCP discovery; fix three doc defects.

  An app team reviewed the published packages before adopting and was right on every point.

  **`accessIdentity(ctx)` — Access identity without parsing a JWT.** Cloudflare attaches the
  authenticated identity to the execution context (shipped 2026-08-14), so a Worker behind
  Access reads `ctx.access.getIdentity()` with no token handling. The kit only offered
  `verifyAccessJwt`, which is the older path.

  ⛔ Both stay, because they are not alternatives: `accessIdentity` for a Worker behind
  Access, `verifyAccessJwt` for an origin that has no `ctx.access` — service-to-service, a
  non-Worker origin, or a Worker reached by service binding, since **`ctx.access` does not
  propagate through bindings**.

  ⚠️ Read groups from `accessIdentity`, not from a token: Cloudflare trims the JWT's
  `custom` claim at roughly 1 KB _silently_, so token-read group membership can be
  incomplete — an authorization bug that only appears for users in many groups.

  **`serveMcpMetadata` / `unauthorizedResponse` — RFC 9728.** The MCP spec requires a server
  to publish Protected Resource Metadata _and_ a 401 naming it in `WWW-Authenticate`.
  Publishing the document while answering a bare 401 leaves clients that follow the header
  with nowhere to go.

  **Three documentation defects, all reported and all real:**

  - `@homeflare/alchemy`'s README documented `@homeflare/alchemy/providers`, which does not
    exist. The real path is `/cloudflare`.
  - `@homeflare/cloudflare`'s npm description advertised "typed bindings" — it exports none.
  - `@homeflare/kit`'s advertised "logging" — `log` lives in `@homeflare/cloudflare`.

  **Packing no longer edits a manifest on disk.** `packForPublish` stripped `scripts` and
  `devDependencies` from the real `package.json`, packed, then restored it — which is a race
  when two smoke tests pack the same workspace dependency in parallel. It destroyed
  `@homeflare/kit`'s `scripts` block during this branch, _after_ `verify` had passed. The
  strip now happens inside the packed tarball, so nothing in the repository is written to.

### Patch Changes

- Updated dependencies [[`5cc2cd6`](https://github.com/taslabs-net/homeflare-kit/commit/5cc2cd62241f926aace1646fd3a1e0057e96cddd)]:
  - @homeflare/kit@0.2.3

## 0.2.2

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

- Updated dependencies [[`093b704`](https://github.com/taslabs-net/homeflare-kit/commit/093b704860b8a0eba5b1690c8f2ab03b3bc3857c)]:
  - @homeflare/kit@0.2.2

## 0.2.1

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

- Updated dependencies [[`3fb58ec`](https://github.com/taslabs-net/homeflare-kit/commit/3fb58ec85e259606f3919ee37e56816317edcd9e)]:
  - @homeflare/kit@0.2.1

## 0.2.0

### Minor Changes

- [#19](https://github.com/taslabs-net/homeflare-kit/pull/19) [`3e06db9`](https://github.com/taslabs-net/homeflare-kit/commit/3e06db93fc945a89229e2230bbe54a849b72dadb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Close a JWKS fetch amplification in `verifyAccessJwt`.

  🔴 Measured on jose 6.2.12 — the version this package pins: five verifications of a
  well-formed token against a **404ing** certs endpoint produced **five outbound fetches**.
  jose records `jwksTimestamp` only inside the `.then()` of a _successful_ fetch, so while
  an endpoint is down it refetches on every call. A Cloudflare Access outage would turn
  every inbound request into an outbound one.

  ⚠️ No jose option fixes this — `cacheMaxAge: Infinity`, `cooldownDuration`, and both
  together all give five fetches.

  The fix installs a circuit breaker at jose's own exported `customFetch` seam, so jose
  keeps doing the caching, cooldown, `kid` matching and verification; the breaker only adds
  the one thing it does not do — remember that a fetch _failed_. A failing URL latches
  closed for 30s, per URL, and a recovered endpoint clears immediately.

  ⛔ The breaker stores only a timestamp and an `Error`, never a `Response`. On workerd a
  Response belongs to the IoContext of the request that created it, so caching one across
  requests throws `Cannot perform I/O on behalf of a different request` — turning a valid
  token into a 401 for every caller but the first.

  Also exports `breakered` and `BREAKER_COOLDOWN_MS` for callers wrapping their own JWKS
  fetches.

## 0.1.3

### Patch Changes

- [#16](https://github.com/taslabs-net/homeflare-kit/pull/16) [`38cfc99`](https://github.com/taslabs-net/homeflare-kit/commit/38cfc99a7f38cbfe013eaa9d853dd0ca93a85b55) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship a README and LICENSE with every package.

  `@homeflare/cloudflare`, `/ui` and `/auth` declared both in `files` and had neither on
  disk, so their npm pages were blank and the tarballs carried no licence text. npm does
  not error on a missing `files` entry — it omits it — so every gate here stayed green.
  `@homeflare/config` never declared `LICENSE` at all.

  The `ui` and `auth` READMEs now say plainly that those packages are scaffolds exporting
  only `VERSION`, and `ui` documents using Kumo directly in the meantime. A bare npm page
  reads as "ready", which is the more expensive mistake.

## 0.1.2

### Patch Changes

- Updated dependencies [[`3b78acc`](https://github.com/taslabs-net/homeflare-kit/commit/3b78acc2a39ce0e01b8a3e55322c56d60b9844bb), [`1b6bd50`](https://github.com/taslabs-net/homeflare-kit/commit/1b6bd5052433cf83371e8df1cf0111aca1840712)]:
  - @homeflare/kit@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`b68f1b7`](https://github.com/taslabs-net/homeflare-kit/commit/b68f1b7159330f5088fd666e91b55b827bb0178d)]:
  - @homeflare/kit@0.1.1

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

### Patch Changes

- Updated dependencies [[`18e975f`](https://github.com/taslabs-net/homeflare-kit/commit/18e975f07565f7998d7192358308cc91f52f92cd), [`342d6f6`](https://github.com/taslabs-net/homeflare-kit/commit/342d6f6496b34735ae96ff31911133f6432e1c67)]:
  - @homeflare/kit@0.1.0
