# Release binaries — what upstream would need

Status: active
Verified: 2026-09-22 (against `alchemy-run/alchemy` at `v2.0.0-beta.79`, read-only:
AGENTS.md and `scripts/generate-api-reference.ts`, plus the installed
`src/Command/Exec.ts`, `src/GitHub/Release.ts`, `src/GitHub/BaseUrl.ts`,
`src/Util/AtomicFile.ts`, `src/Hetzner/Ssh.ts` and `src/Hetzner/Providers.ts`)

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
  observe the path, ensure the bytes, sync mode and owner, read back — not a
  create body and an update body. ⚠️ It does branch on `output` and `olds` for
  **ownership**: only a create may take over a file under `--adopt`
  (`file-converge.ts`), and the in-place guard compares `olds`' pins (gap 3).
- **Props are plain types**, never `Input<T>`, and every prop has JSDoc, with
  `@default` where one applies. ⚠️ Not every attribute: `path`, `mode`, `uid`,
  `gid` and `size` come from `HostFileAttributes` with no JSDoc, so the
  generator would print them bare.
- **The resource JSDoc is the generator's shape**: `### Installing a binary`,
  `**Example:**` with fenced TypeScript, and `@resource` last. (An untitled
  example is titled "Example" by the generator.) ⚠️ The example needs
  `HostDirectory`, `LaunchdJob` and `VICTORIA_RELEASES`, which upstream lacks.
- **Errors are tagged** (`Data.TaggedError`: `BinaryRefused`, `DownloadFailed`,
  `ChecksumMismatch`, `ArchiveRefused`), and nothing casts on `_tag`.
  ⚠️ **They are not typed end to end, so no caller can `catchTag` one**
  (measured, `error-channel.test.ts`). `catalogBinary()` throws, which in a
  stack program is a defect that `catchTag` never sees. The provider's `lift()`
  keeps the instance at runtime but types the channel as `Error` (gap 10).
- **HTTP is Effect's `HttpClient`**, and `reconcile` reports progress through
  `session.note`. A provider layer that brings `FetchHttpClient.layer` itself
  has upstream precedent (`Hetzner/Providers.ts`).
- **The props carry nothing estate-specific.** Paths, owners and modes are the
  stack's. ⚠️ The wiring does carry the estate's name: the host service is
  keyed `homeflare/launchd/HostRunner`, and the ownership notes are
  `Artifacts` keys `homeflare/ownership/*` (gaps 1 and 2).

## What would have to change

1. **The host seam.** Every host touch goes through the kit's promise-based
   `HostRunner`, a Context service under `launchd/`. Upstream would expect an
   Effect service with a neutral key. ⚠️ `Util/AtomicFile.ts` is not that
   service as it stands: it writes a **string** (`writeFileString`) and a mode,
   never bytes, a uid or a gid. `FileSystem` reaches only the deploying
   machine. Upstream's one remote-host seam is `Hetzner.Ssh` (Effect `exec` and
   `scp`). A contribution needs a host service with a local implementation over
   `FileSystem` and a remote one in that shape. The house seam is one file wide
   on purpose, so the swap is local.
2. **Ownership semantics.** The house refuses to adopt without `--adopt`:
   `read` returns `Unowned` even for a byte-identical file, and `reconcile`
   resolves adoption at apply through `ownership/adopt.ts`. That reads
   `Stack.resources[fqn].Adopt`, which upstream marks `@internal`, and state
   rows. Upstream's default for a resource without ownership metadata is
   **plain attributes, which means silent adoption**. A contribution would drop
   `adoptsAtApply` / `noteUnfinished`, ask the engine to hand `adopt` to
   `reconcile`, and settle whether a file on disk is ever adopted silently.
   Worth keeping in any form: a file whose digest is not the pin is never
   adopted, because adopting it is overwriting it (`binary-claim.ts`).
   ⚠️ `declared-pins.ts` reads the same `@internal` record (`.Props`) to refuse
   a pin that was an Output on a first deploy. Upstream applies `Input<T>` to
   every prop automatically, so "this prop must be a literal" is an engine
   feature to propose (the declared props handed to `reconcile`, or a
   literal-only marker), not something a provider can reach for.
3. **`diff` does live I/O and returns `noop`.** Upstream's guidance is that a
   diff should almost never return `noop`. Live I/O has precedent, though:
   `Command.Exec`'s diff hashes a directory and answers `noop` on a match, the
   same shape as this one. Two rules are worth keeping in any form: a new pin
   or path → `replace`, even while `directory` is an Output; and a new pin at
   the same path is refused. The apply-time half of that refusal reads `olds`,
   which upstream's reconciler doctrine calls "at most a hint". Restated as
   observation it reads: the recorded path's live file is not these bytes.
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
9. **The directory must already exist.** `reconcile` refuses a missing one, and
   the kit's `HostDirectory` (linux subpath) is what creates it. Upstream has no
   such resource, so a contribution brings one, or a prop that creates the
   directory with a declared mode and owner.
10. **A typed error channel.** `catalogBinary()` would return an `Effect` that
    fails with `BinaryRefused`, and the provider would fail with the tag union
    instead of `lift()`'s `Error`. `error-channel.test.ts` fails the moment
    either changes, so this page moves with it.
11. **The tar reader accepts one measured layout.** Measured 2026-09-22 against
    `extractMembers`: macOS's default `tar czf` (bsdtar 3.5.3) writes a PAX `x`
    header before every entry (a sub-second `mtime` and the
    `com.apple.provenance` xattr), so even a one-file archive is refused whole.
    `--no-mac-metadata` still writes them; `--format ustar` passes. A wrapping
    directory entry is refused whole. Go's `archive/tar` writing root-level
    files passes. The house accepts this on purpose: the Victoria archives are
    flat, and homeflare-builds writes plain ustar. ⚠️ REASONED NOT MEASURED:
    the Prometheus family's archives (`alertmanager-0.34.1.darwin-arm64.tar.gz`)
    wrap their files in a directory, so the queue in
    release-binary-catalogs.md needs a reader change, not only a data set.
    Generic replacement: skip directory entries, and links that are not the
    declared member, because nothing is ever written from an entry name; read
    PAX records and refuse only a `path`, `linkpath` or `size` record. The
    member digest still guards the bytes.
12. **One source, one tag alphabet, other prop names.** `releaseUrl` fixes
    `https://github.com`. Upstream's GitHub family also reaches GitHub
    Enterprise (`normalizeGitHubBaseUrl`, `GitHub/BaseUrl.ts`). A tag must be
    one `[A-Za-z0-9._-]` segment, so kustomize's `kustomize/v5.8.1` (measured:
    GitHub's own download URL carries the raw `/`) and a changesets-style
    `pkg@1.2.3` are refused at plan. Generic: validate git's ref-name rules,
    segment by segment. Upstream's GitHub props split `owner` and `repository`
    and call a tag `tagName`; this takes `repo: "owner/name"` and `tag`.
13. **No platform check.** `platform` is a catalog key, not a prop, and nothing
    compares the archive's platform with the host. On a Linux runner, a stack
    that asks for `darwin-arm64` gets a Mach-O written, read back and reported
    installed; its unit then fails with "exec format error". Generic: a
    `platform` prop, checked against the host (`uname -sm` through the host
    service) or against the member's executable header.

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
  declared, and stage nothing on disk before the one atomic write. ⚠️ Gap 11 is
  where upstream is likeliest to push back: which entries count as unsafe when
  nothing is written from an entry name.
