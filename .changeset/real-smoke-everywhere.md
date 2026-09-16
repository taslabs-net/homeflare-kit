---
'@homeflare/cloudflare': patch
'@homeflare/config': patch
'@homeflare/auth': patch
'@homeflare/kit': patch
---

Every package now has a smoke test that can actually fail.

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
