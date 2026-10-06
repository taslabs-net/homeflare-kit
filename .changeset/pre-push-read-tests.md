---
'@homeflare/config': minor
---

pre-push runs the test suite in full when a push changes any file that is not `.ts`, `.tsx`, `.js`, or `.mjs`. `bun test --changed` follows imports only, so a docs file or a vendored script was skipped and the failure showed up in CI. Choosing tests by reading their source was dropped: a miss still shipped, and a path in the lane could forge a log line. A module-only push stays on `--changed`. A `package.json`, lockfile, `bunfig.toml`, or `tsconfig` still runs the suite in full, because those files are not modules. The lane log is a fixed reason and a count, never a path. The cost is that a non-module push runs every test.
