# Victoria binaries — what upstream would need

Status: active
Verified: 2026-09-22 (against `alchemy-run/alchemy` AGENTS.md at `v2.0.0-beta.79`, read-only)

`Victoria.Binary` is built so it **could** be contributed to Alchemy. This page
is the honest gap list: what already fits, and what a pull request to
`alchemy-run/alchemy` would have to change first. Nothing here is a promise
that upstream wants it.

## Already shaped for it

- **The lifecycle is beta.79's**: `read`, `diff`, `reconcile`, `delete`,
  `list` returning `[]`. No `create`/`update`. `reconcile` is one flow — observe
  the path, ensure the bytes, sync mode and owner, read back — with no
  `if (output === undefined)` branch.
- **Props are plain types**, never `Input<T>`; every prop and attribute has
  JSDoc, with `@default` where one applies.
- **The resource JSDoc is the generator's shape**: `### Installing a binary`,
  `**Example:**` with fenced TypeScript, `@resource` last.
- **Errors are typed** (`Data.TaggedError`: `BinaryRefused`, `DownloadFailed`,
  `ChecksumMismatch`, `ArchiveRefused`) and callers can `catchTag`; nothing casts
  on `_tag`.
- **HTTP is Effect's `HttpClient`**, and `reconcile` reports progress through
  `session.note`.
- **The core is vendor-neutral.** `tar.ts` (a streaming reader that refuses
  links, `..`, absolute names and renaming headers), `archive.ts` (verify the
  archive, extract one member, verify it), `download.ts` (a pinned-size, bounded,
  deduplicated download) and `checksums.ts` name no Victoria anything. Only
  `catalog.ts`, `release.ts` and the resource do.
- **Nothing estate-specific is baked in** — paths, owners and modes are props.

## What would have to change

1. **Generalise first, then contribute.** The upstreamable resource is a
   verified release binary — say `GitHub.ReleaseBinary` or
   `Command.VerifiedBinary` — taking the URL, size, both digests, the member
   name and the path as props, with the Victoria catalog as a preset on top.
   The kit has a second consumer waiting: `Bao.Plugin` registers a plugin and
   does not deliver it (`openbao/plugin.ts`).
2. **The host seam.** Every host touch goes through the kit's promise-based
   `HostRunner` (and `launchd/file-converge.ts`). Upstream would expect Effect
   services — `FileSystem` for the atomic write, `CommandExecutor` where a
   program runs (as `Command/Exec.ts` does). The seam is one file wide, which
   is the point of keeping it in one place.
3. **Ownership semantics.** The house refuses to adopt without `--adopt`: `read`
   returns `Unowned` even for a byte-identical file, and `reconcile` resolves
   adoption at apply through `ownership/adopt.ts`, which reads the Stack's
   resource map and state rows. Upstream's default for a resource without
   ownership metadata is **plain attributes — silent adoption**. A contribution
   would drop `adoptsAtApply` / `noteUnfinished` and decide, with upstream,
   whether a file on disk should ever be adopted silently.
4. **`diff` does live I/O and returns `noop`.** It reads the file at plan time
   and returns an explicit `noop` when it matches. Upstream's guidance is that a
   diff should rarely return `noop` and usually `undefined`. The version bump
   → `replace` rule (a new path, even while `directory` is an Output) is worth
   keeping in any form.
5. **Layout and exports.** Upstream co-locates contract and provider in
   `src/{Cloud}/{Service}/{Resource}.ts`, re-exports with `export *`, and
   registers providers in a `Providers.ts` collection that `alchemy unsafe nuke`
   enumerates. The house splits files under a 250-line cap, curates its barrel,
   and exports `victoriaProviders(runner)` with no collection. Names would move
   from `VictoriaBinary` to a namespace (`Victoria.Binary` via `import * as`).
6. **Tests.** The house tests run on fakes (`bun:test`, no network, no host).
   Upstream tests run `pnpm test` against the real target, start and end with
   `stack.destroy()`, and verify out of band. For a host resource the honest
   equivalent is a real temporary directory and a real download — which this PR
   did once, by hand, into a scratch directory (victoria-measured.md), and which
   CI here deliberately never does.
7. **Toolchain and style.** pnpm, the alchemy-test runner, `tsc -b`, double
   quotes; generated docs via `pnpm docs:gen`, never hand-edited.
8. **The pull request itself.** A conventional-commit title; no `#` or `##`
   headings in the body (smallest is `###`), summary first with no heading, no
   test plan, code over prose.

## What should NOT change on the way

- ⛔ **Pins in code, not a checksum file fetched at apply.** Mutable releases
  make a fetched checksum file a claim by the same party whose bytes it vouches
  for. A generic resource should take the digests as props and never fetch them.
- ⛔ **Two layers.** Verify the archive before unpacking and the member before
  writing; the vendor publishes both, and the member check is what still holds
  if a reader is ever wrong about a boundary.
- ⛔ **Exact names.** A URL and a member name are matched whole — never a
  prefix, glob or "contains darwin-arm64" — because the enterprise and cluster
  siblings share every prefix.
- ⛔ **Refuse the whole archive** for any unsafe entry, extract only what was
  declared, and stage nothing on disk before the one atomic write.
