---
'@homeflare/alchemy': minor
---

`Release.Binary` can now install from a directory-wrapped vendor archive. `tarReader(wanted, root)`
(`packages/alchemy/src/release/tar.ts`) accepts an optional `root`: exactly one declared leading
directory (typeflag `5`, size 0) is stripped from every entry name before it is matched, listed or
checked for a duplicate. Every entry outside that declared root, a second directory entry, a
`<root>-evil/x` sibling (a segment match, not a string prefix), and a `<root>/` entry that is not
an empty directory are refused whole, same as every existing refusal (PAX, GNU long-name, `..`,
links, devices). Without `root`, behaviour is unchanged: a directory entry — the wrapper included —
is still refused exactly as it always was.

`ReleaseArchive.root?: string` (`binary-form.ts`) carries the pin; `pinProblems` (split out to the
new `binary-pins.ts` to stay under the file's 250-line cap, re-exported so no importer moves)
refuses a root that is not one safe path segment. `catalogBinary` (`catalog.ts`) carries
`archive.root` through when a catalog entry has one. A state row from before this change has no
`root`, and `undefined === undefined`, so it is not treated as a moved pin; declaring or changing a
root is.

Measured 2026-09-23 by downloading each vendor's own GitHub release asset into a scratch directory
(never executed) and re-hashing: all four Prometheus-family darwin-arm64 archives —
`alertmanager` v0.33.1 (37,247,168 B), `blackbox_exporter` v0.28.0 (15,705,022 B), `node_exporter`
v1.12.1 (5,368,643 B), `prometheus-community/postgres_exporter` v0.20.1 (10,072,235 B) — recompute
to GitHub's own asset `digest`, wrap every entry in exactly one directory named
`<binary>-<version>.darwin-arm64/`, and carry no PAX or GNU long-name entries. The worktree's own
`tarReader(wanted, root)` was re-run against those same downloaded bytes and now parses each to
completion, returning the named member at its full pinned size (`docs/release-binary-catalogs.md`
has the full table and commands; `tar-root.test.ts` and `binary-root.test.ts` hold the same proof
as committed fixtures).

This unit adds the reader capability and its tests only. `VICTORIA_RELEASES` and
`OPENBAO_RELEASES` are unchanged — no catalog entry for alertmanager, blackbox_exporter,
node_exporter or postgres_exporter exists yet; that is its own data-set walk-down and PR.
