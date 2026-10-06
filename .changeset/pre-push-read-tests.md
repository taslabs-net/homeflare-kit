---
'@homeflare/config': minor
---

pre-push also runs tests that read a changed non-module file. `bun test --changed` follows imports only, so a docs file, a vendored tree, or another file a test names by path — including through a repo-relative module that test imports — was skipped and the failure showed up in CI. An added non-module path no test names runs the suite in full. An edit of a path no test names stays on `--changed`. A `package.json`, lockfile, `bunfig.toml`, or `tsconfig` still runs the suite in full. A symlinked import is read only when its real path stays inside the repository and outside `node_modules` and `.git`. Import reads stop at 256 KiB per file and 8 MiB together; past that the suite runs in full and the reason is a count. The lane log is the label and that count, so a selected path cannot forge a log line.
