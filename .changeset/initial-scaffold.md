---
'@homeflare/kit': minor
'@homeflare/cloudflare': minor
'@homeflare/ui': minor
'@homeflare/config': minor
'@homeflare/auth': minor
---

Initial release of the HomeFlare shared packages.

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
