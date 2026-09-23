# Release binaries — the data sets, and adding one

Status: active
Verified: 2026-09-23

`Release.Binary` takes one pinned archive as props and knows no vendor. What
each vendor published lives in a **data set** beside it (`src/release/<vendor>.ts`),
typed `ReleaseCatalog`, and `catalogBinary(dataSet, request)` turns one entry
into props. This page is what is in the data sets, and the rule for adding to
them. The guide is [release-binary.md](./release-binary.md).

## `VICTORIA_RELEASES`

| package            | version | asset (darwin-arm64)                            | binaries (installed ← member)                                                                          |
| ------------------ | ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `victoria-metrics` | 1.151.0 | `victoria-metrics-darwin-arm64-v1.151.0.tar.gz` | `victoria-metrics` ← `victoria-metrics-prod`                                                           |
| `victoria-logs`    | 1.52.0  | `victoria-logs-darwin-arm64-v1.52.0.tar.gz`     | `victoria-logs` ← `victoria-logs-prod`                                                                 |
| `victoria-traces`  | 0.10.0  | `victoria-traces-darwin-arm64-v0.10.0.tar.gz`   | `victoria-traces` ← `victoria-traces-prod`                                                             |
| `vmutils`          | 1.151.0 | `vmutils-darwin-arm64-v1.151.0.tar.gz`          | `vmagent`, `vmalert`, `vmalert-tool`, `vmauth`, `vmbackup`, `vmctl`, `vmrestore`, each ← `<name>-prod` |

These are the versions the Mac host runs today, pinned for parity first. An
upgrade (VictoriaMetrics 1.152.0, VictoriaTraces 0.11.1 exist) is its own
change that re-pins both digest layers.

- ⛔ **The single-node `victoria-metrics` archive**, not `-cluster`, which holds
  vminsert, vmselect and vmstorage instead.
- ★ **The `-prod` suffix is dropped on purpose.** The installed names keep a
  job's argv[0], `ps` and `pgrep` names identical to the builds they replace.
  The map is written out per package, never derived.
- **vmalert-logs is not a binary.** It is `vmalert` run with
  `--rule.defaultRuleType=vlogs`: one `ReleaseBinary`, two jobs.
- **A consumer's path.** `catalogDirectory(root, request)` plus the name gives
  `<root>/<package>-<version>/<binary>`, e.g.
  `<root>/vmutils-1.151.0/vmalert`. That is the layout homeflare-mini's
  `binaryPath()` already renders, so its argv and goldens need no path change.
  A stack that keeps its own digest slots (the mini's `PINS`) can compare them
  with `catalogBinary(...).sha256` in its own tests: two witnesses, one source.

## `OPENBAO_RELEASES` — the first data set with a `computed` member

| package   | version | asset (darwin_arm64)                | binaries (installed ← member)                               |
| --------- | ------- | ----------------------------------- | ----------------------------------------------------------- |
| `openbao` | 2.6.2   | `openbao_2.6.2_darwin_arm64.tar.gz` | `bao` ← `bao` (member digest: `computed`, ours — see below) |

Walked down 2026-09-23, every command in
[release-binary-openbao.md](./release-binary-openbao.md).

- ★ **Platform key is `darwin_arm64`, underscore** — OpenBao's own asset
  spelling, not Victoria's `darwin-arm64`. Each data set spells the platform
  the way that vendor's asset names do; nothing here picks one estate-wide
  convention (`openbao.ts`'s header has the rule and the one-line change if a
  reviewer wants it unified).
- ★ **The member digest is `computed`, not `members`.** `checksums.txt` lists
  archives and every `.sbom.json`, never `bao` — the case this page used to
  call out as "that field does not exist yet". It exists now: `catalogBinary`,
  `catalogProblems` and `identifyBinary` all read `members` first, then
  `computed`, and refuse a member pinned in both (`catalog.ts`).
- ★ **GPG checked, Sigstore read but not verified.** `gpgv` against the key
  published at openbao.org confirmed the signature over `checksums.txt`; the
  key's own fingerprint matches OpenBao's install docs. `cosign` is not on
  the mini, so the Sigstore bundle's workflow identity is recorded as
  unverified, not as a passing check.

## Adding a version of a vendor already here

Walk it down from the vendor, never from memory:

1. `gh api repos/<owner>/<repo>/releases/tags/<tag>`: the exact asset names,
   sizes and `digest`s, and `immutable`.
2. Fetch the checksum file. Its SHA-256 must equal GitHub's digest of it, and
   its archive line must equal the archive's digest.
3. Stream the archive through `tar -tvzf -`, saving nothing: root-level
   regular files with the expected member names, nothing else.
4. Add the entry with `recorded` set to that day. Commit the checksum file
   under `src/release/fixtures/<vendor>/` and add the asset names to the
   listing there. `<vendor>.test.ts` then holds the pins to it.
5. Re-check attestations with a positive control, so a 404 means something:
   `gh api repos/<owner>/<repo>/attestations/sha256:<digest>` next to a repo
   known to publish them (`cli/cli` answered 2 on 2026-09-22).

⛔ Never `latest`, and never sort by publish date. VictoriaLogs v1.51.1 was
published after v1.52.0, and VictoriaMetrics interleaves LTS lines.

## Adding a vendor

⛔ **Only after that vendor's own walk-down measures two things**, recorded in
its data module's header with the date:

- **Its checksum format, byte-exact.** `checksums.ts` parses one measured shape,
  `sha256sum` text mode listing the archive and every member. Most vendors the
  estate census found (landscape PR 88) list **archives only**: Prometheus's
  `sha256sums.txt`, vector's `-SHA256SUMS`, pyroscope's and OpenBao's
  `checksums.txt`. For those the member digest is not a vendor fact. It is
  computed from a verified archive, and the data set says so under
  `computed` rather than filing it beside the vendor's `members` lines
  (`catalog.ts`; `OPENBAO_RELEASES` above is the first consumer).
- **Its binary's linkage** (`otool -L` on the extracted member, or `ldd`).
  Vendor binaries were measured self-contained **only for the five Victoria
  ones** (system libraries and `/usr/lib/libresolv.9.dylib` only). That is not
  a property of "a Go binary". The Nix vector links jemalloc, librdkafka,
  oniguruma and libiconv from `/nix/store`, and whether the vendor tarball
  bundles them is unknown until someone inspects the extracted member.

Also carried over from the Victoria walk-down, and checked again per vendor:
exact asset names against near-identical siblings; the tar layout; the
`immutable` flag; signatures and attestations with a positive control; and
where `-version` prints, if anything ever runs it (Victoria's goes to stderr).

The queue, from the census, each **not yet walked for this resource**:
alertmanager, blackbox_exporter, node_exporter and postgres_exporter
(Prometheus `sha256sums.txt`), unpoller (detached `.sig`; 5.2.7 renames
`darwin_arm64` to `darwin_all`), pyroscope and vector. `bao` (OpenBao) is
walked — see `OPENBAO_RELEASES` above.

### The Prometheus family's shape, MEASURED 2026-09-23

★ **Now measured, not reasoned.** All four Prometheus-family darwin-arm64
archives wrap every entry in one directory, so `tar.ts` refused each one
whole — before this unit, on `entry "<root>/" is a directory`. Walking them
down needed a reader change, not only a data set: `tarReader(wanted, root)`
now strips exactly one DECLARED leading directory, pinned as `archive.root`
(gap 11 below, and tar.ts's own header comment, carry the full detail).

Read at `2026-09-23T14:33Z` with `gh api repos/<owner>/<repo>/releases/tags/<tag>`,
then downloaded to a scratch directory (not executed) and re-hashed:

| package (darwin-arm64)                           | asset                                          | size (B)   | `digest` matches  | wrapper directory (root)                |
| ------------------------------------------------ | ---------------------------------------------- | ---------- | ----------------- | --------------------------------------- |
| `prometheus/alertmanager` v0.33.1                | `alertmanager-0.33.1.darwin-arm64.tar.gz`      | 37,247,168 | yes (`a94fbe54…`) | `alertmanager-0.33.1.darwin-arm64`      |
| `prometheus/blackbox_exporter` v0.28.0           | `blackbox_exporter-0.28.0.darwin-arm64.tar.gz` | 15,705,022 | yes (`ec6c70cc…`) | `blackbox_exporter-0.28.0.darwin-arm64` |
| `prometheus/node_exporter` v1.12.1               | `node_exporter-1.12.1.darwin-arm64.tar.gz`     | 5,368,643  | yes (`35b246a3…`) | `node_exporter-1.12.1.darwin-arm64`     |
| `prometheus-community/postgres_exporter` v0.20.1 | `postgres_exporter-0.20.1.darwin-arm64.tar.gz` | 10,072,235 | yes (`4dd2b9e7…`) | `postgres_exporter-0.20.1.darwin-arm64` |

`tar -tvzf` on each downloaded archive (nothing extracted) showed: entry 1 is
the wrapper (typeflag `5`, size 0, `runner`/`circleci` owned), then only
root-level regular files under it — the exporter binary, `LICENSE`, `NOTICE`,
and for alertmanager also `amtool` and `alertmanager.yml`. No PAX (`x`/`g`) or
GNU long-name (`L`/`K`) entries in any of the four. Re-run afterward with the
worktree's OWN `tarReader(wanted, root)` over the same downloaded bytes: every
archive now parses to completion and returns the named member at its full
pinned size (e.g. `alertmanager` → 47,058,626 bytes) — see
`tar-root.test.ts` and `binary-root.test.ts` for the same proof as committed
fixtures.

⛔ **This unit adds the reader capability and its tests, not a new catalog
entry.** No `PinnedArchive` for alertmanager, blackbox_exporter,
node_exporter or postgres_exporter exists here yet — that is a follow-up data
module (its own walk-down of the checksum format: `sha256sums.txt`, archives
only, so member digests would be `computed` like OpenBao's) and its own PR.

⚠️ **`vector` is NOT covered by this measurement or this reader change.**
Vector's queue entry (above) has its own archive shape, unmeasured here; do
not assume it also wraps in a single directory without walking it down
separately.

## What this resource is not for

- **A whole tree.** Grafana needs its homepath and plugins, and an interpreter
  like python-build-standalone needs its `lib/`. That is a **tree mode**:
  unpack an archive into a directory. It is a separate, later capability with
  its own walk-down, not a flag bent onto `Release.Binary`. Grafana's darwin
  builds also come from grafana.com's downloads API, not a GitHub release. (The
  house's stdlib-only Python jobs are tracked for a Bun/TS rewrite instead of a
  vendored interpreter, decided 2026-09-23.)
- **Another source kind.** Only GitHub release downloads, whose URL is
  `https://github.com/<repo>/releases/download/<tag>/<asset>`. A second kind
  (grafana.com JSON, Codeberg) arrives with its first consumer.
- **Another archive format.** Only `.tar.gz`/`.tgz`. A `.zip` or a bare
  binary is refused at plan rather than downloaded and then not unpacked.
- **Builds from source.** Postgres, pgBackRest and Valkey ship no darwin
  binary. Caddy with its plugins and cloudflare-exporter are to be built by the
  public `taslabs-net/homeflare-builds` repo, which publishes GitHub releases
  with a `SHA256SUMS` file (decided 2026-09-23). Each then becomes an ordinary
  data set, after its own walk-down like any vendor's.
