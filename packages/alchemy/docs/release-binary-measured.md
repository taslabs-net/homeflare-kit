# Release binaries — measured, and the limits

Status: active
Verified: 2026-09-22

What [release-binary.md](./release-binary.md) rests on, how each fact was read,
and what is still reasoned rather than measured. Every vendor fact here is
VictoriaMetrics': the only data set so far. Host class: the Mac mini the stack is for
(macOS 27.2, arm64), bun 1.4.0. No binary was executed for any of this.

## The vendor side (read-only, `gh api` and `curl`)

| archive (darwin-arm64)        | bytes       | members (all regular, root-level)    |
| ----------------------------- | ----------- | ------------------------------------ |
| `victoria-metrics-…-v1.151.0` | 12,739,105  | `victoria-metrics-prod`              |
| `victoria-logs-…-v1.52.0`     | 10,943,697  | `victoria-logs-prod`                 |
| `victoria-traces-…-v0.10.0`   | 11,126,077  | `victoria-traces-prod`               |
| `vmutils-…-v1.151.0`          | 123,584,800 | seven `-prod` tools, 264 MB unpacked |

- **Asset names are exact**, and `-cluster`, `-enterprise`,
  `-enterprise-cluster` (and `vlutils`) archives sit beside them with every
  prefix in common — twelve siblings in the darwin-arm64 listing alone. The
  listing is committed as `src/release/fixtures/victoria/darwin-arm64-assets.txt`.
- **Each checksum file hashes both layers**: line 1 the archive, then one line
  per `-prod` member, in `sha256sum` text mode (`<hex>  <name>`, LF, trailing
  newline). For all four, GitHub's asset `digest` equals line 1, and GitHub's
  digest of the checksum file equals the SHA-256 of the committed fixture.
- **Re-read the same day by the supply-chain review** (`gh api …/releases/tags/<tag>`):
  all four archives' and checksum files' sizes and `digest`s still equal the pins
  and the recorded checksum-file digests. Nothing had been swapped since recording.
- **Releases are mutable** (`"immutable": false`), uploaded from maintainers'
  personal accounts. **No signatures or attestations** exist for the archives:
  no `.sig`/`.asc`/`.pem`/`.bundle` assets, and the attestations API answers 404
  for all four digests next to a positive control (`cli/cli`) that answers 200.
- **Tar format**: `tar -tvzf -` on each streamed archive (nothing saved) shows
  only root-level regular files with short names — no directories, links, PAX
  or GNU long-name headers. Owners differ by release (`builder`, `valyala`,
  `ubuntu`), which is why the archive's mode and owner are never used.

## The provider against the real archives

The provider, as `Victoria.Binary` through `victoriaProviders(localRunner())`,
installed all five binaries the stack needs into a scratch directory (never
`/opt`), 2026-09-22. ⚠️ **That was the code before it was generalised into
`Release.Binary`, and the generalised resource has NOT been re-run against the
real archives** (a download needs the operator's go-ahead). What carried over
unchanged: `download.ts`, `tar.ts`, the two checks in `archive.ts` and the write
through `file-converge.ts`. What changed: where the pins come from (props,
filled by `catalogBinary()`) and the URL, now composed from repo, tag and asset
and held equal to the old whole URLs by `victoria.test.ts`.

- **Every digest verified**, both layers, and every installed file's SHA-256 is
  its pin. One run took 1.7–5.9 s on the mini's link.
- **One download for vmagent + vmalert** installed concurrently: `fetch` was
  called once for the shared vmutils archive (counted by wrapping `fetch`).
- **`codesign -v` is valid** on all five as written: the vendor binaries are
  ad-hoc, linker-signed (`flags=0x20002`, no TeamIdentifier) and the write is
  byte-identical, so the embedded signature survives. The running Nix builds are
  the same signature class, and launchd runs them.
- **No `com.apple.quarantine`**, only `com.apple.provenance` — the same as the
  running Nix binaries.
- **No `/nix/store` library** (`otool -L`, all five): `libSystem`,
  `/usr/lib/libresolv.9.dylib`, CoreFoundation, Security. ⚠️ `libresolv.9.dylib`
  is not on disk; it is in the dyld shared cache — a preflight that checks the
  file exists would refuse a working binary.
- **Memory (peak RSS, bun 1.4.0)**: victoria-traces alone ~200 MB; vmalert
  alone ~520 MB; vmagent + vmalert together ~590–720 MB; all five together
  ~750–930 MB. 🔴 Before the gzip input was fed in slices, vmalert alone peaked
  at 1,116 MB: the whole archive inflated in one step and 264 MB of output queued
  ahead of the reader (archive.ts). Before the download filled one pinned-size
  buffer, the chunk list plus its concatenated copy held the archive twice.
- **Under node** (v26.7.0), the bundled extractor reads a gzipped tar the same
  way (`DecompressionStream` is the web standard in both runtimes).

## Through Alchemy's own engine (fakes, not a host)

`src/release/plan.test.ts` runs alchemy@2.0.0-beta.79's Plan and Apply over
in-memory state, with `HostDirectory` declared in front of the binary, a fake
host that models `mkdir`/`rmdir`, and a fake HTTP server:

- **A first deploy** runs `mkdir`, one `GET`, one write, in that order: the
  `directory: dir.path` Output orders them.
- **A version bump** (`HostDirectory('vmutils-<version>')`, `ReleaseBinary('vmalert')`)
  plans `replace` / `create` / `delete` and runs: mkdir new, GET new, write new,
  **then** remove old, **then** rmdir old. That was reasoned from `Apply.ts`
  before; it is measured now, on the engine, not on a host.
- **A version outside the data set** fails in the stack program: zero requests,
  zero host calls.
- **A new pin in the same directory** fails at plan: the directory already
  exists, so its path is resolved when `diff` runs.
- 🔴 **The same bytes re-pinned while the directory is being updated** (its
  path unresolved at plan): with `diff` answering `replace`, the deploy
  SUCCEEDED and the binary was gone. The new generation accepted the identical
  file as its own, and Phase 2 deleted the old generation at the same path.
  `diff` now answers `update` there, and reconcile's in-place guard refuses it
  with the binary kept (`plan.test.ts` pins the refusal).

## The install path on a real filesystem (red team, 2026-09-22)

Measured on macOS 27.2 in temp directories only: no live host, no sudo.

- 🔴 **One file under two spellings was lost, silently** (fixed;
  `binary-alias.test.ts`). Respelling the directory through a symlinked parent,
  or by case alone on case-insensitive APFS, planned a `replace`: the new
  generation took the identical file as its resumed install, then Phase 2
  deleted the old generation's path, which was the same file. The deploy
  succeeded with no binary on disk. Now `diff` compares device and inode
  (`launchd/file-identity.ts`) and answers `update`, and a move never removes
  an old path that is the file it just verified.
- 🔴 **An execute-only mode (`0o111`) was written and then unreadable** (fixed).
  The read-back threw EACCES, the file stayed with no state, and every later
  probe threw the same. Now the mode must be owner-readable, and a read-back
  that throws rolls the create back like one that mismatches.
- 🔴 **Two resources at one path both owned it** (fixed; `binary-claims.test.ts`).
  `vmalert` and `vmalert-logs` declared at one path both created it; the deploy
  that dropped `vmalert-logs` deleted the file `vmalert` still declared, and
  reported `vmalert` as `noop`. A second claim on a path in one run is refused.
- ⚠️ **`/usr/bin/install -S` chmods after the rename.** An lstat poller racing a
  300 MB install saw the new inode at the path as `0600`, then `0755` 0.2–0.4 ms
  later, six runs out of six. Never torn and never wider than declared. localRunner
  sets the mode before its rename. Closing the window under `sudoRunner` changes
  the sudo allowlist, so it has not been done.
- ⚠️ **`install` copies extended attributes**, `com.apple.quarantine` included.
  Files this process writes through `node:fs` carried only
  `com.apple.provenance`, so no staged file is quarantined today.
- ★ **Tar-slip cannot reach the disk by construction.** The installed path is
  `<directory>/<name>`, with `name` one `[A-Za-z0-9._-]` segment; an archive
  entry's name only selects bytes and never becomes a path.

## Reasoned, not measured

- ⚠️ **REASONED NOT MEASURED: a quarantined binary would not start under
  launchd.** Adoption (`--adopt`) and the resume rule accept a file by digest,
  mode and owner, and never read xattrs. A binary that was downloaded by a
  browser and placed by hand would be adopted with its quarantine. Remove it
  (`xattr -d com.apple.quarantine`) before adopting.

- ⚠️ **REASONED NOT MEASURED: a vendor binary runs under launchd from the
  installed path.** Strongly suggested — same signature class as the running
  Nix builds, valid signature, no quarantine — but nothing was executed.
- ⚠️ **REASONED NOT MEASURED: `sudoRunner` installs under the real
  `/opt/<estate>/obs`.** Exercised only over the kit's fake sudo host
  (`binary-sudo.test.ts`: one staged file, one `install -S -m 0755 -o 0 -g 0`,
  the staged file removed on success and on failure).
- ⚠️ **`HostDirectory` under `sudoRunner` does not work today** (measured with
  the kit's fakes during the walk-down): `mkdir` is not on the sudo allowlist,
  and `checkWrite` refuses a directory. A stack that deploys as itself cannot
  create `<root>/<package>-<version>` through sudo yet; deploy as root, or
  pre-create the directory. Fixing it is a sudo-seam change with its own review.
- ⚠️ **REASONED NOT MEASURED: `HostDirectory`'s argv (`mkdir -m`, `chmod`,
  `chown`, `rmdir`) behaves the same on macOS** — its header says so.
- ⚠️ **REASONED NOT MEASURED: the process-memory panels.** The vendor darwin
  builds are `CGO_ENABLED=0` (their Makefile), and VictoriaMetrics' metrics
  library reads darwin RSS only with cgo — the reason the house Nix module
  builds with cgo. Expect `process_resident_memory_bytes` to go missing after
  the swap until someone decides what replaces it. A consumer decision, not
  this provider's.
- ⚠️ **The platform is not checked against the host.** A `darwin-arm64` pin on
  a Linux host installs a binary that will not start; the job's first launch is
  where that shows. The platform is the data set's key, not a prop.
- ⚠️ **A stamped vendor build prints `-version` to stderr**, not stdout
  (`lib/buildinfo`, read). Identity here is the SHA-256 alone; if a check ever
  runs `-version`, read stderr, and say which build (Nix or vendor) it was.
