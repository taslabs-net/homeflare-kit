---
'@homeflare/config': minor
---

pre-push also runs tests that read a changed non-module file. `bun test --changed` follows imports only, so a docs file, a vendored tree, or another file a test names by path — including through a repo-relative module that test imports — was skipped and the failure showed up in CI. An added non-module path no test names runs the suite in full. An edit of a path no test names stays on `--changed`. A `package.json`, lockfile, `bunfig.toml`, or `tsconfig` still runs the suite in full.
