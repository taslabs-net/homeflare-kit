# Victoria binaries — measured, and the limits

Status: active
Verified: 2026-09-22

What [victoria.md](./victoria.md) rests on, how each fact was read, and what is
still reasoned rather than measured. Host class: the Mac mini the stack is for
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
  listing is committed as `src/victoria/fixtures/darwin-arm64-assets.txt`.
- **Each checksum file hashes both layers**: line 1 the archive, then one line
  per `-prod` member, in `sha256sum` text mode (`<hex>  <name>`, LF, trailing
  newline). For all four, GitHub's asset `digest` equals line 1, and GitHub's
  digest of the checksum file equals the SHA-256 of the committed fixture.
- **Releases are mutable** (`"immutable": false`), uploaded from maintainers'
  personal accounts. **No signatures or attestations** exist for the archives:
  no `.sig`/`.asc`/`.pem`/`.bundle` assets, and the attestations API answers 404
  for all four digests next to a positive control (`cli/cli`) that answers 200.
- **Tar format**: `tar -tvzf -` on each streamed archive (nothing saved) shows
  only root-level regular files with short names — no directories, links, PAX
  or GNU long-name headers. Owners differ by release (`builder`, `valyala`,
  `ubuntu`), which is why the archive's mode and owner are never used.

## The provider against the real archives

The provider, through `victoriaProviders(localRunner())`, installed all five
binaries the stack needs into a scratch directory (never `/opt`), 2026-09-22:

- **Every digest verified**, both layers, and every installed file's SHA-256 is
  its catalog pin. One run took 1.7–5.9 s on the mini's link.
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

## Reasoned, not measured

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
- ⚠️ **REASONED NOT MEASURED: the version bump order.** Alchemy's replace is
  create-first with old generations collected in a later phase (Apply.ts, read
  not run), so a job whose argv holds `binary.path` restarts on the new binary
  before the old file goes. A running daemon keeps its unlinked inode either way.
- ⚠️ **REASONED NOT MEASURED: the process-memory panels.** The vendor darwin
  builds are `CGO_ENABLED=0` (their Makefile), and VictoriaMetrics' metrics
  library reads darwin RSS only with cgo — the reason the house Nix module
  builds with cgo. Expect `process_resident_memory_bytes` to go missing after
  the swap until someone decides what replaces it. A consumer decision, not
  this provider's.
- ⚠️ **The platform is not checked against the host.** `darwin-arm64` on a
  Linux host installs a binary that will not start; the job's first launch is
  where that shows.
- ⚠️ **A stamped vendor build prints `-version` to stderr**, not stdout
  (`lib/buildinfo`, read). Identity here is the SHA-256 alone; if a check ever
  runs `-version`, read stderr, and say which build (Nix or vendor) it was.
