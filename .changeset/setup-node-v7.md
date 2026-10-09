---
'@homeflare/config': patch
---

The rendered `ci.yml` now pins `actions/setup-node@v7` (was `@v6`) for repositories that declare `node:` in their shape. Dependabot cannot land this bump in a consumer: `ci.yml` is rendered by this package, so a hand bump fails the consumer's `repo-shape` drift test. The pin moves here, and a consumer picks it up with the config bump plus `bun run repo-shape:refresh`.
