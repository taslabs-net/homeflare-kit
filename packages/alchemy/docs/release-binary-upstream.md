# Release binaries — what upstream would need

Status: active
Verified: 2026-09-22 (against `alchemy-run/alchemy` AGENTS.md at `v2.0.0-beta.79`, read-only)

`Release.Binary` is built so it **could** be contributed to Alchemy. This page
is the honest gap list: what already fits, and what a pull request to
`alchemy-run/alchemy` would have to change first. Nothing here is a promise
that upstream wants it.

## Already shaped for it

- **Generic before its first release.** It began as `Victoria.Binary` with the
  catalog inside the resource. It was generalised before any state row carried
  that type name, because a rename after release would be a state migration.
  The pinned archive (repo, tag, exact asset name, size, archive digest,
  member, member digest, installed name) is props. Vendor data sets sit beside
  it as plain modules. Alchemy could ship the resource without shipping anyone's
  pins.
- **Named the upstream way.** The type is `Release.Binary` (`Namespace.Kind`).
  Under upstream's layout it would be `src/Release/Binary.ts`, imported as
  `import * as Release from "alchemy/Release"`, used as `Release.Binary`. The
  house exports the prefixed `ReleaseBinary`, as it does `HostFile` and
  `LaunchdJob`. Upstream's `GitHub.Release` already means _publishing_ a
  release, so the GitHub namespace would be the confusing home.
- **The lifecycle is beta.79's**: `read`, `diff`, `reconcile`, `delete`,
  `list` returning `[]`. No `create`/`update`. `reconcile` is one flow —
  observe the path, ensure the bytes, sync mode and owner, read back — with no
  `if (output === undefined)` branch.
- **Props are plain types**, never `Input<T>`, and every prop and attribute has
  JSDoc, with `@default` where one applies.
- **The resource JSDoc is the generator's shape**: `### Installing a binary`,
  `**Example:**` with fenced TypeScript, and `@resource` last.
- **Errors are typed** (`Data.TaggedError`: `BinaryRefused`, `DownloadFailed`,
  `ChecksumMismatch`, `ArchiveRefused`), callers can `catchTag`, and nothing
  casts on `_tag`.
- **HTTP is Effect's `HttpClient`**, and `reconcile` reports progress through
  `session.note`.
- **Nothing estate-specific is baked in.** Paths, owners and modes are props.

## What would have to change

1. **The host seam.** Every host touch goes through the kit's promise-based
   `HostRunner` (and `launchd/file-converge.ts`). Upstream would expect Effect
   services: `FileSystem` for the atomic write (upstream has
   `Util/AtomicFile.ts`), and `CommandExecutor` where a program runs, as
   `Command/Exec.ts` does. The seam is one file wide on purpose.
2. **Ownership semantics.** The house refuses to adopt without `--adopt`:
   `read` returns `Unowned` even for a byte-identical file, and `reconcile`
   resolves adoption at apply through `ownership/adopt.ts`, which reads the
   Stack's resource map and state rows. Upstream's default for a resource
   without ownership metadata is **plain attributes, which means silent
   adoption**. A contribution would drop `adoptsAtApply` / `noteUnfinished`
   and settle with upstream whether a file on disk should ever be adopted
   silently.
3. **`diff` does live I/O and returns `noop`.** It reads the file at plan time
   and answers `noop` when it matches. Upstream's guidance is that a diff
   should rarely return `noop` and usually `undefined`. Two rules are worth
   keeping in any form: a new pin or path → `replace`, even while `directory`
   is an Output; and a new pin at the same path is refused.
4. **Layout and exports.** Upstream co-locates contract and provider in
   `src/{Cloud}/{Service}/{Resource}.ts`, re-exports with `export *`, and
   registers providers in a `Providers.ts` collection that `alchemy unsafe nuke`
   enumerates. The house splits files under a 250-line cap, curates its barrel,
   and exports `releaseProviders(runner)` with no collection.
5. **Where the data sets live.** Upstream ships no estate's pins. The resource,
   `catalogBinary()` and the tar reader would go upstream; `victoria.ts` and its
   fixtures would stay in the kit, or become a documented example.
6. **Tests.** The house tests run on fakes (`bun:test`, no network, no host),
   plus Alchemy's real Plan and Apply over in-memory state (`plan.test.ts`).
   Upstream tests run `pnpm test` against the real target, start and end with
   `stack.destroy()`, and verify out of band. For a host resource the honest
   equivalent is a real temporary directory and a real download. That was done
   once, by hand, before the generalisation (release-binary-measured.md), and
   CI here deliberately never does it.
7. **Toolchain and style.** pnpm, the alchemy-test runner, `tsc -b`, double
   quotes; generated docs via `pnpm docs:gen`, never hand-edited.
8. **The pull request itself.** A conventional-commit title; no `#` or `##`
   headings in the body (the smallest is `###`), the summary first with no
   heading, no test plan, and code over prose.

## What should NOT change on the way

- ⛔ **Pins in code, never a checksum file fetched at apply.** Mutable releases
  make a fetched checksum file a claim by the same party whose bytes it vouches
  for. A pin that is an Output is refused for the same reason.
- ⛔ **Two layers.** Verify the archive before unpacking and the member before
  writing. The member check is what still holds if a reader is ever wrong about
  a boundary.
- ⛔ **Exact names.** An asset and a member are matched whole, never by a
  prefix, a glob or "contains darwin-arm64", because the enterprise and cluster
  siblings share every prefix.
- ⛔ **Refuse the whole archive** for any unsafe entry, extract only what was
  declared, and stage nothing on disk before the one atomic write.
