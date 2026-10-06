---
'@homeflare/config': minor
---

pre-push also runs tests that read a changed non-module file. `bun test --changed` follows imports only, so a docs file, a vendored tree, or another file a test names by path was skipped and the failure showed up in CI. A path no test names is unchanged. A `package.json`, lockfile, `bunfig.toml`, or `tsconfig` still runs the suite in full.
