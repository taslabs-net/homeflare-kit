---
'@homeflare/config': minor
---

New export: `@homeflare/config/versions`, which publishes the estate's one aligned version
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
