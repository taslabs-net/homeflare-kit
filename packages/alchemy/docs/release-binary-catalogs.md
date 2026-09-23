# Release binaries — the data sets, and adding one

Status: active
Verified: 2026-09-22

`Release.Binary` takes one pinned archive as props and knows no vendor. What
each vendor published lives in a **data set** beside it (`src/release/<vendor>.ts`),
typed `ReleaseCatalog`, and `catalogBinary(dataSet, request)` turns one entry
into props. This page is what is in the data sets, and the rule for adding to
them. The guide is [release-binary.md](./release-binary.md).

## `VICTORIA_RELEASES` — the only data set today

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
  computed from a verified archive, and the data set must say so rather than
  file it beside the vendor's lines. That field does not exist yet; it arrives
  with its first consumer.
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
`darwin_arm64` to `darwin_all`), pyroscope, vector, and `bao` (OpenBao, with
GPG and Sigstore to check).

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
