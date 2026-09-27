# Alchemy changelog archive 11

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

Create-and-assert only: every optional prop (`encoding`, `localeProvider`, `lcCollate`,
`lcCtype`, `allowConnections`, `connectionLimit`, `isTemplate`, `tablespace`) is asserted once
at create and compared against the live row on every later plan — a mismatch is a typed
`PostgresDatabaseDrift` refusal, never an `ALTER DATABASE`. `name` is refused at plan past 63
UTF-8 bytes (`NAMEDATALEN`), because the server would otherwise silently truncate it with only
a `NOTICE`. A rename is refused at plan; `diff` never answers `replace` (a replace here is DROP
then CREATE, on data). `delete` always refuses with a typed tag and `defaultRemovalPolicy` is
`retain` — dropping a database stays a human act on the host. `CREATE DATABASE` takes no bind
parameters at all (measured at `gram.y`), so every value is quoted by hand: a single-token
identifier quoter for the name (deliberately NOT `alchemy`'s own `sql(value)`, which
dot-splits a qualified name and would break on a name containing `.`), and a string-literal
quoter for the rest. `read` always answers `Unowned` for a match — a database carries no
ownership mark, so an adopting stack needs `adopt(true)`.

Measured path (2026-09-23): only a Unix socket reaches the maintenance database on the mini —
no `pg_hba` rule opens it over TCP. A JS client reaches that socket: `@effect/sql-pg` under
Bun, live-checked from scratch space, connected and read all 24 live databases.

- [#160](https://github.com/taslabs-net/homeflare-kit/pull/160) [`26f45bd`](https://github.com/taslabs-net/homeflare-kit/commit/26f45bda0108744994c63b611ca27492aef715fe) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Release.Binary` can now install from a directory-wrapped vendor archive. `tarReader(wanted, root)`
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

### Patch Changes

- [#161](https://github.com/taslabs-net/homeflare-kit/pull/161) [`5500f3e`](https://github.com/taslabs-net/homeflare-kit/commit/5500f3e83e90b9e7a0bbad457527f994a741d0d2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Correct the last stale claim in `Proxmox.ZfsPool`'s docs, per Tim's decision 28 (2026-09-23).

  PR 154 already corrected `zfs-pool.ts`'s header, which previously said destroy was refused and
  `delete` made no API call — false, since `destroyPool` sends a real `DELETE` under
  `.pipe(RemovalPolicy.destroy())`, guarded only by the resource's default `retain` removal policy.
  That fix missed one line: the file's "PRIVILEGES, FROM THE SCHEMA" paragraph still said `delete`
  "needs nothing at all, since it calls nothing" — the same mistake, left uncorrected in a second
  place. It now says `delete` needs `Sys.Modify` on `/`, the same as `reconcile`'s POST, per
  `ceph-osd.ts`'s own privilege comparison (measured against the same 2026-09-13 apidoc read),
  which names `disks/zfs` as one of the sibling families whose write verbs — not only the create —
  carry a `Sys.Modify` check.

  No behaviour change. `RemovalPolicy.destroy()` reaching a single `DELETE`, and `retain` sending
  none, are already pinned in `zfs-pool-adopt.test.ts` (added by PR 154); this PR touches docs only.

## 0.23.0

### Minor Changes

- [#154](https://github.com/taslabs-net/homeflare-kit/pull/154) [`2044487`](https://github.com/taslabs-net/homeflare-kit/commit/2044487b81fecb635da785b0b2637daf2c5b20fe) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `ProxmoxApiToken` and `ProxmoxZfsPool` from `@homeflare/alchemy/proxmox`, per Tim's
  decision 9 (2026-09-23): the kit builds an ApiToken export that is metadata-only and a ZfsPool
  export that is adopt-only. Neither can create what it does not already have to adopt.

  `ProxmoxApiToken` adopts and manages `comment`, `expire` and `privsep` — the whole of a token's
  policy that PVE will report back — and refuses to mint a new one: the secret exists for one HTTP
  response and then nowhere (measured from the vendor schema), and this estate's state store
  persists attributes unencrypted, so a token created here would be a live credential nobody holds.
  `reconcile` dies by name when the token is absent, naming the two ways to get a usable one
  (`pveum user token add`, or OpenBao's `proxmox-c1` mount) instead. `shape()` is now typed against
  the generated `AccessUsersUseridTokenTokenidPutParams` and `PostParams`, so a schema drift fails
  `tsc` here rather than surfacing as a 400 on a live cluster.

  `ProxmoxZfsPool`'s `devices` and `raidlevel` are now optional: omitting both declares an
  adopt-only pool, for one PVE's own POST schema cannot fully describe — a stripe layout has no
  `raidlevel` to declare. `ZfsRaidLevel` and `ZfsCompression` are now generated aliases of
  `NodesNodeDisksZfsPostParams`'s fields rather than hand-typed, so PVE adding or removing a
  `raidlevel` value is caught by `tsc`, not discovered on a live cluster. `createPool` refuses
  before any POST when an adopt-only declaration's pool is not already there. `zfs-pool.ts`'s
  header previously said destroy was refused and `delete` made no API call — that was false
  (`destroyPool` sends a real `DELETE`, guarded only by the resource's default `retain` removal
  policy); the header is corrected, and `delete` is unchanged.

  Walked down against the manifest-verified `pve-apidoc` cache, pve-manager 9.2.11/f6997e698c7933ea,
  sha256 `9def8f13611184ee1c7d0399713130dfc4a065701d0d91a69b9c03df929344e9` — re-sliced for this
  change with `codegen/apidoc.ts`'s own parser (2026-09-23), rather than assumed from the header's
  2026-09-13 measurement. The four endpoint definitions this change touches (`POST`/`GET`/`DELETE`
  `/nodes/{node}/disks/zfs[/{name}]`, `GET`/`POST`/`PUT`/`DELETE`
  `/access/users/{userid}/token/{tokenid}`) are byte-identical against the cached 9.2.4 apidoc, so
  nothing here is pinned to a version drift between them.

### Patch Changes

- [#152](https://github.com/taslabs-net/homeflare-kit/pull/152) [`0a19365`](https://github.com/taslabs-net/homeflare-kit/commit/0a19365c9370f315e0fa0dba6700934e4a7022fc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix the Proxmox type generator (`codegen/`) to read a property's own `oneOf`, not just its outer `optional`. Measured 2026-09-23 against pve-manager 9.2.11: six PVE SDN fabric request parameters and seven return fields under `/cluster/sdn/fabrics/*` (`delete`, `redistribute`, `interfaces`) are spelled `{oneOf: […], type: 'array'}` with no outer `optional`, one branch per routing protocol, every branch `optional: 1` — a property that is optional in every case the vendor states, which the generator previously read as required. `isOptional` (exported from `codegen/tsmap.ts`) now treats a property as optional when it says so itself or when every `oneOf` branch does (one branch without `optional` still keeps it required), and an array property with no `items` of its own but a `oneOf` gets its element type from the deduplicated union of each branch's own mapped `items`. `codegen/emit.ts`'s constraint-table required flag routes through the same helper, so a future fabric Resource is not refused at plan time for omitting a key the vendor never requires. Regeneration touches only `packages/alchemy/src/proxmox/generated/pve/cluster-sdn-fabrics.ts` (+23/−13); nothing in `packages/` imports its types yet. `codegen/TYPES.md` records what stays unclaimed: the branches' own per-protocol `instance-types` are not read, so the element type is a superset across protocols rather than a discriminated union — that decision belongs to the `SdnFabric`/`SdnFabricNode` family this unblocks.

## 0.22.0

### Minor Changes

- [#148](https://github.com/taslabs-net/homeflare-kit/pull/148) [`2a8fc6e`](https://github.com/taslabs-net/homeflare-kit/commit/2a8fc6ef5f634c52a7dfa59f3f0e3464d83aea7c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Refuse two of a stack's own launchd jobs sharing one port, before either is declared: `@homeflare/alchemy/launchd` now exports `claimPorts(claims)` and the pure `portClaimProblems(claims)` it runs on. Like `catalogBinary()`, this is a plain function the stack program calls itself (a provider never sees its sibling resources, and never diffs a first create whose props still hold an unresolved `Output` — every mini job's does), so a colliding declaration fails the plan before anything is fetched, written or `launchctl`'d. It keys on the port number alone, mirroring `lib-ports.nix`'s `assertNoCollision` in the house repo, the check it replaces for a job once that job moves off Nix — address and protocol are not part of the key, matched against that registry's own strictness rather than a new, looser rule. Walked against Darwin 27.2.0 (macOS 27.2): a wildcard bind and a specific-address bind on the same port both succeed at the OS level (measured with SO_REUSEADDR, which Go sets on every darwin listener unconditionally), so `claimPorts` refuses that pairing deliberately rather than relying on the OS to catch it. It sees only the claims a stack passes it — a forgotten job, or a daemon still on Nix, stays invisible until its port is added as a claim.

- [#149](https://github.com/taslabs-net/homeflare-kit/pull/149) [`6b8d88f`](https://github.com/taslabs-net/homeflare-kit/commit/6b8d88f9d3b68286f2d83a64358ecb1e84909629) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `@homeflare/alchemy/release` gets its second vendor data set, `OPENBAO_RELEASES`: OpenBao 2.6.2 for darwin_arm64, walked down 2026-09-23 (`docs/release-binary-openbao.md` has every command). OpenBao's `checksums.txt` lists archives and SBOMs only, never the `bao` binary inside the archive — the first vendor the kit has pinned where the member digest is not a vendor fact. `catalog.ts` gains an optional `computed` record per archive for exactly that case (hashed from an archive whose own SHA-256 already matched the pin, filed separately from `members` and never both at once — a member pinned in both is refused) and an optional `checksums.signature` record for a vendor that publishes a detached signature over its checksum file; `catalogProblems`, `catalogBinary` and `identifyBinary` all read vendor digests first, then computed ones. Both fields are optional and `VICTORIA_RELEASES` is unchanged, so nothing that already builds against this package needs to change. The `checksums.txt` signature was checked once with `gpgv` against the key published at openbao.org; the accompanying Sigstore bundle was read but not verified (`cosign` is not installed where this was walked down), and is recorded as an unverified identity rather than a passing check. `docs/release-binary.md`'s "Declaring one" example also gets a real bug fixed: `ReleaseBinary('vmalert')` followed by `LaunchdJob('vmalert')` shares one alchemy@2.0.0-beta.79 FQN, so the second declaration silently returns the first resource instead of registering a job — the example now uses distinct ids and says why.

## 0.21.0

### Minor Changes

- [#138](https://github.com/taslabs-net/homeflare-kit/pull/138) [`ef4108a`](https://github.com/taslabs-net/homeflare-kit/commit/ef4108a54c3700485cedb102833f16da54f02d3e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Install vendor binaries from pinned release archives: `@homeflare/alchemy/release`. `ReleaseBinary` puts one binary out of a GitHub release archive into a directory the stack declares, and installs nothing else. The pinned archive is its props — repository, tag, exact asset name, size, the archive's SHA-256, the archive member and the member's own SHA-256 — so the resource knows no vendor. Each vendor's pinned versions are data kept beside it; `VICTORIA_RELEASES` is the first set, covering `victoria-metrics`, `victoria-logs`, `victoria-traces` and the `vmutils` tools (`vmagent`, `vmalert`, …) at the versions the Mac host runs, each digest copied from the vendor's checksum file with its URL and date. `catalogBinary(VICTORIA_RELEASES, { package, version, platform, binary })` turns an entry into props, and refuses a version the data set does not pin — in the stack program, so the plan fails before anything is fetched. Every pin must be a plain value in the stack program: one wired from another resource's Output (a checksum file read during the deploy) is refused before any request, on a first deploy too. Every download is checked twice: the archive before anything is unpacked, then the binary before it is written. Asset names are matched exactly, so the `-enterprise` and `-cluster` archives next to them are never picked. Only the declared member is extracted, and an archive holding any link, `..` or absolute entry is refused whole. The bytes reach the host only through the existing `HostRunner` write. A new pin at the same path is refused rather than overwriting a running binary; give each version its own directory (`catalogDirectory`). A binary someone already placed is recognised by its SHA-256, never by running it, and is taken over only under `--adopt`, without a download — at apply too, where the plan could not ask. A file with other bytes at the path is never taken over, `--adopt` or not, so a plan never prints `adopted` for a binary it would overwrite. A renamed declaration keeps its binary: declare the rename with `renamedFrom()`, and under `--adopt` the old name's delete leaves a path the new name installed in the same deploy. It never starts anything: the stack's job puts the binary's `path` in its argv. `HostFile` now shares its whole-file convergence with it, with no change in behaviour.

### Patch Changes

- [#138](https://github.com/taslabs-net/homeflare-kit/pull/138) [`ef4108a`](https://github.com/taslabs-net/homeflare-kit/commit/ef4108a54c3700485cedb102833f16da54f02d3e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - A `HostFile` or `ReleaseBinary` whose path is respelled to the same file — through a symlinked parent such as `/etc` and `/private/etc`, or by case alone on case-insensitive APFS — is now planned as an `update` that keeps the file. Before, it was planned as a `replace` whose cleanup deleted the old path, which was the same file: the deploy succeeded and the file was gone until the next one. `HostRunner.stat` may now report `dev` and `ino` (the local runner does); a runner that does not gets a check after the move, so a lost file fails the deploy instead. A create whose read-back throws (not only one that mismatches) is now removed. `ReleaseBinary` also refuses a mode its owner cannot read, and a directory that group or other may write. It refuses, too, a second resource installing the same path in one deploy: two owners of one file meant that dropping either one deleted the file the other still declared.

## 0.20.0

### Minor Changes

- [#139](https://github.com/taslabs-net/homeflare-kit/pull/139) [`70e8899`](https://github.com/taslabs-net/homeflare-kit/commit/70e8899fe70cf5426bcbf11b498a658b60f9488b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `ProxmoxCephDaemon`, `ProxmoxCephFs` and `ProxmoxCephOsd` from `@homeflare/alchemy/proxmox`, so a stack can adopt a live cluster's Ceph monitors, managers, metadata servers, CephFS and OSDs. Each is adopt-only by shape: none has an update path, the daemon and filesystem compare nothing so they can never plan a replace, and an OSD is created only when `dev` is declared. All three retain on destroy, so removing a declaration drops its state row and never sends a DELETE. `ProxmoxCephFlag` stays Provider-only on purpose: a declared flag reasserts a maintenance toggle such as `noout` on every deploy.

### Patch Changes

- [#135](https://github.com/taslabs-net/homeflare-kit/pull/135) [`925454b`](https://github.com/taslabs-net/homeflare-kit/commit/925454b5d9fbefea061a3a204e4b0093a79c0bdc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Two ways a `Remote.File` managed region could break its own promise, and a systemd rename that
  refused too late. All three found by reviewing the merged diff and reproduced against the fake
  Linux host before anything was changed.

  🔴 **A REGION RENAME LEFT THE OLD BLOCK IN THE FILE FOREVER.** Only `path` was identity, so changing
  `region.name` — or its `comment` token, which is part of the marker line — planned a routine
  `update`: the new markers were spliced in, the old ones were never touched, and `delete` could only
  ever look for the name in state, which was now the new one. Reproduced: a vendor file ended up
  carrying two `BEGIN` blocks and destroying the resource removed one of them. For the named
  consumers that is two `anchor` lines in a packet filter and a duplicate entry in a host table, with
  nothing in the stack able to take either back. A rename is now a MOVE: the new block is written and
  verified, then the old one is removed, and the stored digest is re-read afterwards so it describes
  the file that is actually there.

  🔴 **DROPPING `region` TOOK OVER A FILE THIS RESOURCE DID NOT OWN.** Same cause, worse effect: the
  plan said `update` and the apply replaced every byte of the other owner's file with this resource's
  few lines. That is the one thing the managed-region design exists to make impossible. A flip between
  owning the whole file and owning a block — in either direction, at the same path — is now a
  PLAN-TIME REFUSAL, because neither order is safe: writing the whole file first destroys the other
  owner's bytes before anything can be undone, and removing the block first destroys our own claim and
  then refuses. Destroy the resource and declare a new one.

  🔴 **A `Systemd.Unit` RENAME WHOSE `content` WAS STILL AN OUTPUT WAS NOT CHECKED AT ALL.** The
  resolved rename is checked in the plan since the systemd preflight; the branch `diffHandler` takes
  while `content` is unresolved — exactly the deploy that templates a rendered config's digest into
  the unit — still returned `{ action: 'replace', deleteFirst: true }` with no check, and Alchemy
  deletes the old unit BEFORE reconciling the new one. A rename onto a masked name therefore took the
  service down and only then refused. The half of the check that needs only the new name — the old
  unit deletable, the new one writable and not masked — now runs there too. ⛔ This forbids nothing
  that used to work: the identical refusal was always going to fire in reconcile, just later and with
  nothing running.

- [#142](https://github.com/taslabs-net/homeflare-kit/pull/142) [`1905f18`](https://github.com/taslabs-net/homeflare-kit/commit/1905f18c30f7ae2a6d7294d588bf18396b64f4ed) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Two new docs, and no code change.

  `docs/provider-standard.md` is the kit-side statement of the house standard for a custom
  Alchemy provider. It keeps the standard's rule numbers, and each rule is cited upstream at
  `alchemy@2.0.0-beta.79`. It covers four things. First, use upstream's resource when one
  exists. Second, route every vendor call through `@distilled.cloud/<vendor>` when that
  package exists. Third, use Alchemy's own helpers (`alchemy/Util/sha256`, `Util/poll`,
  `Util/AtomicFile`, `Diff`, `Tags`, `PhysicalName`, `AdoptPolicy`, `Auth` and `Test/Bun`)
  rather than house copies. Fourth, keep `src/**` provider code runtime-portable, because
  this package builds with `--target node`, while tests, fakes, scripts and codegen stay
  Bun-native. The page also records, per family, the vendor version each one was walked
  against and where that record lives. Six families record it only in prose.

  `docs/upstream-conformance.md` is the audit of every family against that standard, as a
  ranked ledger. It was measured read-only on `925454b`. The findings, in rank order:
