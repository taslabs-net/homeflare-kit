# @homeflare/kit

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
