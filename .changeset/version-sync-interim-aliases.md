---
---

Release tooling only (no package changes): `bun run version` now moves every `npm:` alias that
points at a workspace package (the interim distilled SDKs in `packages/alchemy`) onto that
package's new version, then refreshes `bun.lock`. Without it the Version Packages PR bumped
`@homeflare/distilled-netbox` to 0.3.0 while `packages/alchemy` still pinned 0.2.0, and CI's
`bun install --frozen-lockfile` failed (PR 195).
