# @homeflare/kit

## 0.3.0

### Minor Changes

- [#36](https://github.com/taslabs-net/homeflare-kit/pull/36) [`cff4111`](https://github.com/taslabs-net/homeflare-kit/commit/cff4111c2f4461a45be5811547125b1f5d98c6d2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship the HTTP and Website SDK surfaces apps were hand-rolling.

  **`@homeflare/kit/openapi`** — `createOpenApiApp()` is OpenAPIHono with one
  readable validation hook. The document and the request share a Zod schema.
  Subpath, not the main entry: a Node script that only wants `parseEnv` must not
  resolve Hono. Peers: `hono`, `@hono/zod-openapi`, `zod` (optional). Import `z`
  from `@hono/zod-openapi`.

  **`astroWebsite` / `viteWebsite`** on `@homeflare/alchemy/cloudflare` — house
  flags on Alchemy's own stacks. Astro gets `disable_nodejs_process_v2` (workerd
  process-v2 returns `[object Object]`). Vite is TanStack Start / static Vite.
  Not Nextjs: that helper hashes source and plans as create against a live Worker.

  Catalog also pins `@tanstack/react-router` 1.170.35, `@tanstack/react-start`
  1.168.52, `@tanstack/react-query` 5.102.8 — match these, do not wrap them.

## 0.2.3

### Patch Changes

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

## 0.2.0

### Minor Changes

- [#13](https://github.com/taslabs-net/homeflare-kit/pull/13) [`3b78acc`](https://github.com/taslabs-net/homeflare-kit/commit/3b78acc2a39ce0e01b8a3e55322c56d60b9844bb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `rateLimitAware`, a ky hook that honours `x-ratelimit-reset-after`.

  Measured against ky 2.1.0: `retry-after: 1` is honoured (waited 1006ms) but
  `x-ratelimit-reset-after: 1` is **ignored** (303ms — ky's own backoff). Discord and
  Discord-shaped APIs send the latter, with fractional seconds, and it is the more precise
  of the two when both appear.

  ```ts
  import { client, rateLimitAware } from '@homeflare/kit';
  const discord = client(base, rateLimitAware);
  ```

  Also exports `retryAfterMs` and `MAX_RETRY_WAIT_MS` for callers doing their own waiting.
  The wait is capped at 30s: an uncapped sleep on a global 429 can be an hour, which is
  indistinguishable from a hang.

- [#15](https://github.com/taslabs-net/homeflare-kit/pull/15) [`1b6bd50`](https://github.com/taslabs-net/homeflare-kit/commit/1b6bd5052433cf83371e8df1cf0111aca1840712) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `upstream()` and `writableUpstream()` — a client for one API, carrying that API's
  quirks so no caller re-derives them.

  ky stays the transport; this adds only what ky has no opinion about:

  - **Fails closed on a missing credential**, and distinguishes the two ways it happens: an
    empty value means the secret did not render, `"null"` means the binding name is wrong.
    Omitting the header instead produces a bare 401, which reads as a bad credential and
    sends an operator to rotate a good secret.
  - **Never follows a redirect.** An unauthenticated request is often answered with a 302 to
    a login page; following it returns HTML with status 200, which reads as a broken API.
  - **Per-upstream auth schemes.** Django REST Framework wants `Token <value>`; Bearer
    returns 401 there, and a wrong scheme is indistinguishable from a wrong credential.
  - **Reads and writes are separate functions.** `upstream()` exposes GET only. Writes need
    `writableUpstream()`, so widening is a visible choice rather than a flag.

  ```ts
  const grafana = upstream({
    system: 'grafana',
    urlVar: 'GRAFANA_URL',
    defaultUrl: 'http://127.0.0.1:3000',
    tokenVar: 'GRAFANA_TOKEN',
    pathPrefix: '/api',
  });

  await grafana.get('/dashboards').json<Dashboard[]>();
  ```

## 0.1.1

### Patch Changes

- [#6](https://github.com/taslabs-net/homeflare-kit/pull/6) [`b68f1b7`](https://github.com/taslabs-net/homeflare-kit/commit/b68f1b7159330f5088fd666e91b55b827bb0178d) Thanks [@taslabs-net](https://github.com/taslabs-net)! - No consumer-visible change. Release tooling only: the publish step now streams npm's
  output and confirms each version against the registry before reporting success.

## 0.1.0

### Minor Changes

- [`18e975f`](https://github.com/taslabs-net/homeflare-kit/commit/18e975f07565f7998d7192358308cc91f52f92cd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `KitError` and `kindForStatus`, and harden `parseEnv` against the `"null"` binding.

  Both are ported from the estate's `@homeflare/mcp-kit`, where 34 packages proved them:

  - **`isUnset`** — `''`, `"null"` and `"undefined"` all mean absent. An unbound workerd
    binding arrives as the four-character _string_ `"null"`, so code checking only for the
    empty string sends `Authorization: Bearer null` and gets a bare 401 that reads like a
    bad credential. Values are also trimmed, since a rendered env file has a trailing
    newline.
  - **`kindForStatus`** — 429 maps to `rate_limited`, never to an argument error, so a
    throttled caller waits instead of rewriting a correct call.
  - **`KitError`** — names the failing system, carries a remedy, and exposes `retryable`
    so a caller stops retrying a `forbidden`.

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
