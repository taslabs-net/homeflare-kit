# @homeflare/alchemy

## 0.24.0

### Minor Changes

- [#157](https://github.com/taslabs-net/homeflare-kit/pull/157) [`2a69523`](https://github.com/taslabs-net/homeflare-kit/commit/2a69523410521f8373d2c216070f788df0ca2a64) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `LiteLLM.PassThroughEndpoint` to `@homeflare/alchemy/litellm`, the kit's first LiteLLM
  resource: one row of LiteLLM's `/config/pass_through_endpoint` family, a route on the proxy that
  forwards requests to an upstream target. Types are generated from LiteLLM **1.100.0**'s own
  OpenAPI document (tag `v1.100.0`, commit `e4f25265704e2b2c6cf6e81be2e4c5cffff896f4`), dumped the
  way the vendor's own CI dumps it — `prisma generate` against `litellm/proxy/schema.prisma`, then
  the `dumpSpec` program embedded in `ui/litellm-dashboard/scripts/gen-api-types.mjs`, run with
  `app.routes`' `include_in_schema` forced `True` the way the dashboard's generator does — because
  the reference proxy's `/openapi.json` could not be reached when this was walked (jetsam restart
  loop). Cross-checked byte-identically: regenerating with `openapi-typescript@7.13.0` reproduces
  the tag's committed `ui/litellm-dashboard/src/lib/http/schema.d.ts` exactly, sha256
  `8bc5d9c9…40b83f9`, 2,334,248 bytes on both sides. The dump itself is sha256
  `1b3e4d23…4b006399f` (`codegen/manifest.json`'s `litellm-openapi` entry).

  Every pass-through endpoint lives in one `general_settings.pass_through_endpoints` field — every
  create, update and delete is a read-modify-write of the whole list — so every mutating call is
  wrapped in a per-base-URL `Effect` semaphore, and `reconcile` reads back after writing rather
  than trusting the call that just returned. A path already held by a `config.yaml` entry
  (`is_from_config: true`) is refused at plan rather than silently overridden; a foreign DB row on
  the same path is `Unowned` and needs `--adopt`; a literal secret in a forwarded `Authorization`,
  `x-api-key` or `cf-aig-authorization` header is refused unless it carries LiteLLM's own
  `os.environ/NAME` reference form. Clearing `timeout`, `methods` or `guardrails` is planned as a
  replace (delete then create), because LiteLLM's update route merges with `exclude_none` and can
  never clear an already-set field. Credentials (`LITELLM_PROXY_URL`, `LITELLM_PROXY_API_KEY` —
  LiteLLM's own variable names) are read fresh from the environment on every call, never a prop.

  Deferred: the Claude OAuth model, key and team slice, which needs estate answers only Tim can
  give. See `docs/litellm.md`.

- [#156](https://github.com/taslabs-net/homeflare-kit/pull/156) [`6b4b58c`](https://github.com/taslabs-net/homeflare-kit/commit/6b4b58c9a207dd4351d80e514ee4b7d09cc74ea0) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Create-and-assert a database on a self-hosted cluster: `Postgres.Database` in the new
  `@homeflare/alchemy/postgres` subpath. Walked against PostgreSQL 18.6 (`REL_18_6`, commit
  `724edf9b`) — upstream `alchemy@2.0.0-beta.79` has vendor-API Postgres resources (Planetscale,
  Neon, Prisma, Fly, Railway) and a runtime binding over `@effect/sql-pg`, but nothing for a
  database you run yourself, so this builds on that same `@effect/sql-pg` `PgClient` upstream's
  own `alchemy/SQL/Postgres` uses (new optional peer, `@effect/sql-pg@4.0.0-rc.115`).

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

  1. `R2BucketLock` uses `Effect.orDie` and `Effect.promise`. Its reconcile trusts `output`
     rather than the live lock, and it sits on a second Cloudflare SDK where
     `@distilled.cloud/cloudflare/r2` already has the lock operations.
  2. `forgejo/client.ts` is hand-rolled, while `@distilled.cloud/forgejo@1.0.0-rc.12` is
     generated against Forgejo 16.0.3.
  3. `MeshNode` is a deliberate twin of `Cloudflare.Tunnel.WarpConnector`.
  4. Shipped provider code calls `Bun.*` or the `node:*` modules upstream bans (14 of 17
     listed files; the other 3 use only synchronous `node:crypto` or `Buffer`, which upstream
     allows inside `Effect.sync`), and 51 test files run on `node:test` instead of
     `bun:test`.

  What the ledger records is the gap for each finding. It changes nothing.

## 0.19.1

### Patch Changes

- [#128](https://github.com/taslabs-net/homeflare-kit/pull/128) [`ba55148`](https://github.com/taslabs-net/homeflare-kit/commit/ba5514820e32f9d546f1a5eb0f92c7f156f2a978) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Estate topology out of the constraint proofs. PR [#118](https://github.com/taslabs-net/homeflare-kit/issues/118)'s create-form proofs used the real
  declarations verbatim, which put a metrics hostname, a cluster's `api-path-prefix` and three Ceph
  pool names into `src` — and `src` ships in the npm tarball of a public repository, so they would
  have stayed in the git history forever. `lxc-harness.ts` states the rule and these tests did not
  follow it: a production-SHAPED declaration with placeholder values, because the proof is about
  which keys the create form sends and which bounds they face, never about the strings.

  No behaviour changes; the same forms are checked against the same tables.

- [#136](https://github.com/taslabs-net/homeflare-kit/pull/136) [`64d4c36`](https://github.com/taslabs-net/homeflare-kit/commit/64d4c36091054fa05b716f1d4029c1feea955289) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Check a systemd rename at plan time. A unit's name or directory change is a delete-first replace, and Alchemy deletes the old unit before reconciling the new one, so a masked name, a unit file someone else owns, or a runner that will not write the new path used to be noticed only after the old unit was already stopped. Those checks now run while planning, and again at apply when the new name was still an Output and the diff could not see the rename. A file byte-identical to this declaration's render stays exempt: it is a deploy that died between write and reload.

## 0.19.0

### Minor Changes

- [#120](https://github.com/taslabs-net/homeflare-kit/pull/120) [`512bf1a`](https://github.com/taslabs-net/homeflare-kit/commit/512bf1a6a973bdbd1c9688d295dcf8a067820a36) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Linux hosts on the existing HostRunner seam: `@homeflare/alchemy/linux`.

  The kit could declare a guest and nothing inside it. This adds the families that gap
  was missing, on the same seam the launchd subpath already drives a Mac through — so
  `HostFile`'s ownership rules, `checkWrite` and the adoption doctrine come along unchanged.

  - `sshRunner({ host })` — a Linux `HostRunner` over the operator's own ssh config.
    ⛔ `BatchMode=yes` and host verification untouched; ⛔ every remote script reports its
    status behind a per-runner nonce, so a dropped connection is an Error and never a
    "nothing is there"; ⛔ `privileged: false` — nothing calls sudo.
  - `HostDirectory` — because no file resource creates a parent. One directory, never a
    chain; delete is `rmdir`, never recursive.
  - `RemoteFile` — a whole file, or one MANAGED REGION (`BEGIN`/`END` markers) inside a
    file this resource does not own. ⛔ Every byte outside the markers stays identical, the
    file's own mode and owner are copied back, and a delete removes only the block.
  - `SystemdUnit` / `SystemdTimer` — unit file, `daemon-reload`, enable/disable,
    start/stop. ⛔ A deploy NEVER mass-restarts: a unit restarts only when its own file
    changed, when state or systemd says the loaded copy is stale, or when a digest the
    declaration listed in `restartOn` changed. An adopted unit that already matches is not
    restarted, reloaded or started.

  `systemctl` and `stat` shapes measured read-only on Debian 13 / systemd 257, 2026-09-22;
  the write subcommands are reasoned and read back rather than assumed. Unit files render
  verbatim — there is no machine-readable directive schema to generate from, so the kit
  invents none. Guide: `docs/linux-host.md`.

## 0.18.0

### Minor Changes

- [#118](https://github.com/taslabs-net/homeflare-kit/pull/118) [`5ae4e91`](https://github.com/taslabs-net/homeflare-kit/commit/5ae4e91919a101da3d8605a069c65e0301d0cccc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Every Proxmox family that writes to the vendor is now checked against the vendor's own schema —
  35 of 35, up from 19, covering 75 endpoints instead of 37. A family left unwired was a write this
  package made with nothing between the declaration and the server's 400, which is the shape of the
  2026-09-22 `deploy:pbs` incident this feature exists for.

  Newly wired: `Proxmox.ApiToken`, `CephDaemon`, `CephFlag`, `CephFs`, `CephOsd`, `CephPool`, `Lxc`,
  `MetricServer`, `NetworkApply`, `NodeNetwork`, `NotificationTarget`, `SdnApply`, `SdnSubnet`, `Vm`,
  `ZfsPool`, and `Pbs.NotificationTarget` — which was missing from the sweep list and carries the
  incident's own rule, `comment: maxLength 128`, on all three of its creates. Families that write
  their own handlers (`CephOsd`, `Lxc`, the two applies, `Pbs.NotificationTarget`) reach the same
  check by name through `guardForm`, as `Pbs.Datastore` already did; families with a spec declare
  `endpoint`. `tests/constraint-wiring.test.ts` derives the census from the ownership ledger, so a
  family added without an endpoint fails there rather than on a deploy, and each newly wired family
  has a proof test that runs its REAL create form through the vendor's create table and requires no
  violations.

  🔴 **A live bug this found.** `Proxmox.NodeNetwork`'s create form never sent `iface`, which PVE
  marks required on `POST /nodes/{node}/network` while `{node}` is its only path parameter. Every
  interface create this package could have made would have 400ed; nothing caught it because the
  estate's interfaces were all adopted, which takes the PUT path. `createBody` now sends it, and the
  PUT still does not — there `iface` is the path.

  ⛔ **Presence of a vendor-required parameter is now demanded only when a create is really about to
  happen**, not whenever the create form is built. `Proxmox.NotificationTarget` cannot send gotify's
  `token` or smtp's `password` — they are write-only secrets and props are persisted unencrypted — so
  the documented workflow is to create the target out of band and then declare it. Under the old
  unconditional check that adopt-then-update would have been refused forever; now it plans clean,
  while asking to CREATE a gotify target fails at plan with PVE's own `token: required`. The guards
  move into `resource-guard.ts` and are exported from `pveOperations`, so `CephPool`'s hand-written
  reconcile gets them too.

  An **action** endpoint with no form is wired as well (`PUT /cluster/sdn`, `PUT /nodes/{node}/network`):
  the table is empty, but the key is resolved against the vendor schema at generation time, so a PVE
  that moves or withdraws an apply fails `bun run check` instead of an `ifreload -a` on three nodes.

  `PveSpec['endpoint']` now also admits a function of props, for the two families whose endpoint is
  chosen by a prop — `NotificationTarget`'s four PVE types and `CephDaemon`'s mds/mgr/mon, each with
  its own parameter schema. Every key it can return is still a literal in this package's source,
  because the generator finds endpoints by scanning text.

  Generator changes that came with the volume: `/cluster` and `/nodes/{node}` are split one level
  further down, because they are routes rather than areas — PVE's own viewer expands them — so the
  tables are now 18 files (`pve-cluster-sdn.ts`, `pve-nodes-ceph.ts`, …), all inside the 250-line
  house cap. The generator deletes a file it no longer produces, `tests/schema-manifest.test.ts`
  enumerates the directory instead of a hand-written list and checks every table is claimed by the
  manifest entry it came from, and two PVE bounds published as JSON strings (`bwlimit`'s
  `minimum: "0"`, `count`'s `maximum: "16777216"`) are parsed to numbers — a faithful reading of a
  stated value; a bound that is not a number at all is still dropped rather than guessed at.

## 0.17.0

### Minor Changes

- [#114](https://github.com/taslabs-net/homeflare-kit/pull/114) [`3316006`](https://github.com/taslabs-net/homeflare-kit/commit/3316006513196622551d4cc041986089dc28ffc4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The Proxmox API type generator, written from the vendor schemas, and the widening it removes.
  `packages/alchemy/src/proxmox/generated/{pve,pbs}.ts` carried the header
  `Run: bun codegen/generate.ts` from the day they were committed, and
  `git log --oneline --all -- 'codegen/generate*'` is empty at every commit: that file existed
  nowhere. The mapping was therefore readable only as its own 8,196 lines of output — nobody could
  reproduce it, correct it, or say which schema version it described. Because nobody could read it,
  nobody noticed what it did: it kept `type`, `enum` and `optional`, dropped every `maxLength`,
  `minLength`, `minimum`, `maximum`, `pattern`, `format`, `typetext`, `default` and description, and
  covered 407 of PVE's 678 endpoints and 46 of PBS's 367 with no record of which 407 or why.

  `bun codegen/types.ts` is that generator, with `--check`, the same manifest and the same
  sha256-as-identity rule as `codegen/constraints.ts`. It emits every endpoint both products
  document — 678 PVE and 367 PBS, 1,619 exported types — split across 89 files by the vendor's own
  path and packed back up so the split is no deeper than the 250-line house cap requires. Every file
  names its manifest entry, the product version the host reported and the sha256 of the bytes it was
  read from. `generated/pve.ts` and `generated/pbs.ts` stay as `export *` barrels, so no import in
  this package or any consumer moves.

  ⛔ **An integer request parameter is `` `${number}` ``, not `string`.** `pbs:POST /config/verify`'s
  `max-depth` is `integer, minimum 0, maximum 7` in PBS's schema and was `'max-depth'?: string` in
  the type, which accepts `'banana'`; 480 PVE and 151 PBS parameters were widened that way. They are
  now the wire spelling of a number: still assignable to `PveForm`, still carried unchanged through
  `violations`' bound check, and no longer satisfied by an arbitrary string. It is deliberately NOT
  `number`: `client.ts` sends `application/x-www-form-urlencoded` and types the body
  `Record<string, readonly string[] | string>`, so a `number` could not be handed to `pve()` at all,
  and `constraints.ts` iterates a form value on `typeof value === 'string'`. ⚠️ `String(n)` does not
  typecheck against it — write `` `${n}` ``. A boolean parameter stays `'0' | '1'`, which is the
  encoding `values.ts`'s `flag()` already produces rather than a widening. Responses are JSON and
  keep their real `number` and `boolean | 0 | 1`.

  The old output is reproduced before it is changed, which is what makes the diff reviewable: run
  against the same two schemas with integers left widened, the pipeline re-emits all 646 PVE and 69
  PBS declarations identically, with two recorded exceptions — `NodesNodeLxcVmidConfigGetReturn`'s
  `lxc` becomes `readonly (readonly string[])[]` rather than a readonly array of mutable ones, and 21
  declarations break lines differently because `oxfmt` had reformatted the committed files before
  every `generated` directory reached its ignore list. The naming is the old generator's, reproduced
  rather than improved: `ClusterBackupIdIncluded_volumesGetReturn` keeps its underscore, because
  renaming sixty exported types in the commit that changes what the types mean would hide the second
  change inside the first.

  ⛔ Parameter schemas wrapped in `allOf`/`oneOf` are read through `codegen/parameters.ts` (PR [#113](https://github.com/taslabs-net/homeflare-kit/issues/113)),
  not asked for as `parameters.properties`. `POST /cluster/ha/rules` and `PUT /cluster/ha/rules/{rule}`
  are the two PVE endpoints that need it; a reader that misses them emits a type with no fields, which
  is indistinguishable from an endpoint that takes nothing. An unresolvable schema gets a doc comment
  naming the construct and **no** `Params` type — neither product needs that on these versions.

  ⛔ "Closed object" is spelled differently by the two products, and a test for one lies about the
  other. Measured over both whole schemas: PVE writes numbers (`additionalProperties: 0` on 617
  objects, `1` on 21, absent on 352), PBS writes booleans (`false` on 560, `true` on 36). An absent
  `additionalProperties` is open — the vendor never promised the list was exhaustive.

  ⛔ Eight PVE files are over the house cap and cannot be split. Each holds the endpoints of one
  vendor path whose parameters carry enums of hundreds of members — `rootfs`, `mp0`…`mp255`,
  `unused0`…`unused255` for the volume moves, the ACME DNS provider list, the QEMU CPU model list. A
  single type declaration is the smallest unit there is; dropping the enum would widen the parameter
  back to `string`. Each says so in its own header and `tests/schema-types.test.ts` pins the list.

  `tests/schema-type-mapping.test.ts` holds the mapping to shapes lifted from the committed files and
  needs no schema cache, so it runs on CI. `tests/schema-types.test.ts` checks provenance, the
  barrel against the files on disk, the cap, the coverage counts and five endpoints the old generator
  omitted, and runs `bun codegen/types.ts --check` when the cache is present — skipping with the
  refresh command when it is not. `codegen/TYPES.md` carries the reasoning.

## 0.16.1

### Patch Changes

- [#113](https://github.com/taslabs-net/homeflare-kit/pull/113) [`4fe8cef`](https://github.com/taslabs-net/homeflare-kit/commit/4fe8cef3154ad0f373b291f413dcbd570602e6fa) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Proxmox.HaRule`'s constraint table was empty and nothing said so.

  MEASURED 2026-09-22: PVE spells `POST /cluster/ha/rules` as `parameters: {allOf: [{properties:
{rule}}, {oneOf: [node-affinity, resource-affinity]}]}` — a discriminated union. The apidoc reader
  asked for `parameters.properties`, got `undefined`, and emitted `{}`. A wired family's plan-time
  guard therefore checked **nothing**, and an empty table is indistinguishable from an endpoint whose
  parameters happen to carry no rules. `comment` there has a `maxLength` of 4096 and `affinity` an
  enum of two.

  `codegen/parameters.ts` reads both combinators, and their logic is their meaning. `allOf` branches
  all apply, so their properties MERGE — a key claimed by two branches would have to satisfy both,
  which this does not compute, so it stops rather than picking one. `oneOf` branches are
  ALTERNATIVES, so they INTERSECT: only what every branch states identically survives, because
  enforcing a rule from one branch would refuse a legal declaration of the other kind. `nodes` and
  `strict` exist only on node-affinity and are therefore not enforced. ⚠️ `optional` is intersected
  toward optional rather than field-by-field: its ABSENCE means required, so dropping a disagreeing
  `optional` would have read as required and refused every legal node-affinity rule, whose `affinity`
  is optional where resource-affinity's is not.

  ⛔ And a parameter schema this file cannot read is now recorded as `unresolved` and **stops the
  generator** for any endpoint this package writes to, rather than producing the empty table that hid
  the problem. `tests/schema-manifest.test.ts` covers the reader directly.

  ⛔ `docs/api-coverage.*` had the identical blind spot from its own parser: it reported
  `/cluster/ha/rules` as having **zero** parameters and zero gaps. `scripts/api-schema.ts` now reads
  the combinators through the same resolver — 5 parameters, 2 unenforced, both `format` names.
  ⚠️ Two parsers for one file format is the deeper defect; merging them is its own change.

- [#116](https://github.com/taslabs-net/homeflare-kit/pull/116) [`54479fc`](https://github.com/taslabs-net/homeflare-kit/commit/54479fc7792076fb0e718b55588cc815823818c2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Netbox.Prefix` no longer erases prose it did not declare.

  🔴 **The bug, found by review rather than by an incident.** The resource sent `description: ''`
  whenever the prop was absent. On a create that is invisible — the field was empty anyway. ⛔ On an
  **adopt** it is data loss: NetBox is the estate's record of DECISIONS, so a prefix's description is
  usually the only written trace of why that range exists. The first deploy that adopted one would
  have PATCHed it to empty, `matches` would have reported drift, the plan would have said `update`,
  and the diff would have read as converging a declaration rather than deleting a sentence.

  ★ **The tell was an inconsistency inside the same file, not a failure.** Optional foreign keys were
  already omitted when undeclared, with a comment explaining that sending `null` would clear a tenant
  somebody set in the UI. Free text had the identical hazard and the opposite treatment. Two fields,
  one hazard, two answers — that gap is the defect.

  ★ **The line is now drawn at what the vendor itself defaults.** `status`, `is_pool` and
  `mark_utilized` have defaults in NetBox's schema, so omitting one genuinely means "the default" and
  settling it says what NetBox would have done anyway. `description`, `comments` and the optional
  foreign keys have no such default — the schema's `''` is the absence of a value, not a decision —
  so they are omitted from the body and left uncompared until declared.

  ⛔ **Whatever `matches` compares, `body` must send**, or the plan says `update` forever: the PATCH
  omits the field, so the next read is unchanged. The two moved together here and
  `prefix-form.test.ts` asserts the invariant.

  ⚠️ **The cost, stated:** prose can no longer be cleared by omission. Clearing it is
  `description: ''`, written on purpose — the readable way to say a destructive thing.

  `body` and `matches` are extracted to `prefix-form.ts` so both are pure functions a test can call
  with a literal, the way the Proxmox families keep their `*-form.ts` beside the resource.

## 0.16.0

### Minor Changes

- [#110](https://github.com/taslabs-net/homeflare-kit/pull/110) [`9fa5800`](https://github.com/taslabs-net/homeflare-kit/commit/9fa5800c8a1d2d3fb831d29ae64e9145e82fe48f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - A NetBox provider, generated from NetBox's own OpenAPI document — `@homeflare/alchemy/netbox`.

  `Netbox.Prefix` declares one IP prefix and the decision recorded against it. It is the first object
  class for three measurable reasons: `WritablePrefixRequest.required` is exactly `["prefix"]`, so it
  is the only interesting NetBox object with **no foreign-key prerequisite** (a VLAN needs `vid` and
  a group; a Device needs a role, a type and a site — four more Resources before the first one can be
  declared); a prefix is the atom of what NetBox is for, the record of what the network was DECIDED
  to be; and `status: 'deprecated'` is how a retired range stops being folklore in an SSH config
  comment and becomes a line with a reviewable diff.

  ⛔ **The constraint tables are generated, never hand-typed.** `bun codegen/netbox.ts` reads NetBox
  4.7.0's OpenAPI 3.0.3 document, verifies its sha256 against `codegen/manifest.json`, and emits the
  committed tables plus `docs/netbox-coverage.md`. A key naming an endpoint the vendor does not have
  stops the generator. This is the same pipeline that exists because a PBS deploy adopted ten objects
  and then failed its one create on a `maxLength: 128` the generated type did not carry — NetBox gets
  it **before** its first write rather than after.

  ⛔ **Two of NetBox's seven regexes are not JavaScript in meaning, and both compile cleanly.**
  Measured over the whole document: `^[-\w]+$` (`slug`) and `^[\w.@+-]+$` (`username`). Python's `\w`
  is Unicode on a `str`, so Django accepts `zürich-core` and a verbatim JavaScript copy refuses it —
  a plan blaming the operator for a legal value, which is worse than the server-side 400 the table
  replaces. ⚠️ The `u` flag does not fix it. Both are dropped, recorded as `patternSource` with no
  `pattern`, and the generated header says nothing enforces them.

  ⚠️ **The document was pinned to the vendor's release tag, not read from an instance, and the
  manifest says why.** The reference instance could not answer `/api/schema/`. The published document
  was then cross-checked against a snapshot the estate took from its own instance while it was up:
  1256 operations on each side, `(method, path)` sets identical with zero difference. ⛔ That verifies
  the path surface only — the snapshot discards request bodies, which is the half this generates —
  so every constraint rests on the vendor document alone.

  Also here:

  - Adopt-first by construction: `reconcile` locates before it writes, and ⛔ an ambiguous identity
    **fails** rather than binding to whichever row NetBox ordered first.
  - 🔴 **One guessed filter shape was caught before it shipped, and the fix is structural.** The
    prefix locate first narrowed server-side with `vrf_id=null`, the sentinel NetBox uses for "no
    foreign key" — `FILTERS_NULL_CHOICE_VALUE = 'null'` is real. ⛔ But in the vendor's own source
    at v4.7.0, `PrefixFilterSet.vrf_id` is a plain `ModelMultipleChoiceFilter` with no `null_value`:
    it never opted in, so `'null'` fails queryset validation and NetBox answers **400 on every plan
    for every global-table prefix**. `locate` now sends only filters the document declares and a new
    `identifies` picks the row in this process, where the rule is readable and testable offline.
  - `retain` on removal for every family, because deleting a NetBox row reparents children and
    detaches IP assignments; the `delete` handler is fully implemented anyway.
  - Read/write shape asymmetry handled in `values.ts` — `status` is written as `"active"` and read
    back as `{value, label}`; a foreign key is written as `4` and read back as `{id, url, display}`.
    Comparing those directly reports drift on every plan, forever.
  - ⛔ No credential is ever a prop. `NETBOX_URL` and `NETBOX_TOKEN` are read at call time, and
    `Authorization: Token`, not `Bearer` — a wrong scheme and a wrong credential look identical in
    the response.
  - ★ **`codegen/param-rules.ts` gains a dialect table, and `emit.ts` is untouched.** There are
    exactly two vendor facts about a pattern — which dialect it is written in, and whether the
    vendor anchors it — so they live together per product rather than as a string every function
    switches on. ⛔ NetBox gets the Django translator and no anchoring: its own 7 patterns already
    carry `^…$` and Django validates with `re.search`, so re-anchoring would invent a rule. PVE is
    the opposite case and keeps its measured anchoring. Every existing Proxmox table regenerates
    byte-identical.

### Patch Changes

- [#108](https://github.com/taslabs-net/homeflare-kit/pull/108) [`6586b0d`](https://github.com/taslabs-net/homeflare-kit/commit/6586b0decb5201e57f9e086619d1f658e5bce94d) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Adversarial review of the vendor-constraint guard, same day it shipped: two rule kinds were passing
  through it unchecked, and the coverage report did not know the guard existed.

  ⛔ **PVE anchors every pattern and the tables did not.** MEASURED read-only on a cluster node,
  `/usr/share/perl5/PVE/JSONSchema.pm:1636`: `if ($value !~ m/^$pattern$/)`. The published pattern is
  the INSIDE of an anchored match — PVE ships `[A-Za-z][A-Za-z0-9\-\_]+` for a firewall alias name —
  and `RegExp.test` is a search, so `ok name!` matched on its `ok`, planned clean and was rejected by
  PVE with the 400 the guard exists to prevent. All eleven PVE patterns in the tables were toothless
  this way. The anchoring is textual rather than `(?:…)`, because Perl's is: three of PVE's 72
  patterns carry a top-level `|`, and `^a|b$` is not `^(?:a|b)$`. `\n?` before the `$` is Perl's `$`,
  which matches before a final newline where JavaScript's does not — without it the guard would refuse
  values PVE accepts, which is worse than the 400. PBS is untouched: all 37 of its patterns already
  carry their own `^…$` and Rust's `is_match` is a search.

  ⛔ **An array states its rules on `items`, and the emitter read only the parameter.** 30 tabled
  parameters are arrays and 11 state real limits one level down — PBS `target` (2–32 chars, a name
  pattern), `associated-key`, the `delete` enums, PVE `secondary-controllers` (max 64). `violations`
  was already checking every element of a repeated key against a row that had no rules in it. Those
  rules now merge into the row, which says `each: true`; `required` is never taken from `items`.

  ⛔ **`patternFlags` is emitted instead of discarded.** `translatePattern` lifts PBS's leading `(?m)`
  to a flag and the first generation returned it and threw it away, so a multi-line rule would have
  been enforced with single-line semantics. No tabled endpoint uses one today; this is the guard for
  the day one does.

  ⛔ **`docs/api-coverage.md` called the 128-character comment unenforced.** It was generated from the
  vendor schema alone, hours after the tables started enforcing 321 rows of it, so the gap column
  counted every rule the guard had just closed — including the one the report opens by describing.
  `POST /config/verify` now reads `unenforced: []`, PBS's owned gap falls 144 → 62 and PVE's 545 →
  490, and a `format` is still never subtracted because the tables record the name and check nothing.

  ⛔ **The two manifests named two different PVE schemas.** `codegen/manifest.json` said 9.2.11 and
  `schemas/manifest.json` said 9.2.4 — both true of this genuinely mixed-version cluster, differing by
  two write endpoints, and nothing said so. Both now name the same bytes and the same versioned cache
  filename, and `tests/schema-manifest.test.ts` fails if they ever diverge again.

  New tests: `constraints-dialect.test.ts` holds a mutant for each newly enforced kind, and
  `constraints-live.test.ts` runs all ten objects of the live PBS inventory — the real ids, stores,
  schedules and retention values, comment text replaced by same-length filler because this package is
  public — through their create AND update tables expecting zero violations, which is the false
  positive this feature could itself cause. `constraints.test.ts` is split at the 250-line house cap.

## 0.15.0

### Minor Changes

- [#106](https://github.com/taslabs-net/homeflare-kit/pull/106) [`fc026e7`](https://github.com/taslabs-net/homeflare-kit/commit/fc026e7b81d937f614515abe8b2a2d7bb2a2d019) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Forward every `Bao.*` family's `Props` and `Attributes` types from `@homeflare/alchemy/openbao`.

  Each family already re-exported its own types from its module, but the barrel forwarded only the
  VALUES for seven of them — `BaoAuthMethod`, `BaoCloudflareRole`, `BaoMount`, `BaoPkiRole`,
  `BaoPolicy`, `BaoProxmoxRole` and `BaoSshRole` — plus `BaoAuthRoleAttributes`,
  `BaoPluginAttributes`, `BaoJwtRoleAttributes` and `BaoJwtCallbackMode`.

  ⛔ This is a bug only a consumer could see, and only one that obeys the rules. A stack may use
  Resources the package entry exports and must not deep-import, so it could be handed
  `BaoProxmoxRole` and still be unable to name its props — leaving it to write the shape out and
  hope it stayed in step. MEASURED 2026-09-22 in homeflare-openbao, which did exactly that for
  `BaoProxmoxRole` while declaring the VPS proxmox engine. For that family the cost is highest:
  `mount` + `name` + `mintUser` + `ttl` + `maxTtl` IS the whole role, so a hand-written copy
  duplicates the entire server-side state of a family whose `mintUser` is its security boundary.

  Additive and type-only: no value, signature or runtime behaviour changes, and nothing that was
  importable stops being importable. `src/openbao/index-types.test.ts` pins the surface with a
  type-only test — `tsc --noEmit` is the assertion, so a family whose props stop being reachable
  from the package entry fails here instead of in another repo's next consumer.

- [#107](https://github.com/taslabs-net/homeflare-kit/pull/107) [`734ef60`](https://github.com/taslabs-net/homeflare-kit/commit/734ef6067e504be20c65ce7ec9c221c54554d7e7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The provisioning baseline takes a comment per object, so it can describe a cluster that
  already exists.

  `provisionBaseline` and `provisionBootstrap` carried ONE `comment` for the mint group and
  both mint users. That can only describe a cluster this baseline made. The common case is
  the other one: a cluster that already has its mint group and its read user, each with its
  own live comment, both of them already declared at those values by the stack that adopted
  them. A single comment made the generated script modify all three, and the next deploy of
  that stack wrote them back — a loop that reads like drift and is not. Measured on an
  estate cluster on 2026-09-22, where the mint group had no comment at all and the read user
  named its own mount.

  `ProvisionNames` now adds `groupComment`, `provisionComment` and `readComment`, each
  defaulting to `comment`, so the generic case is still one string and an override changes
  exactly one object:

  ```ts
  provisionBootstrap({
    role: 'LXCProvisioner',
    groupComment: '', // live: no comment at all
    readComment: 'mint target: read (ops)', // live: its own wording
    provisionComment: 'mint target: provision (ops)', // the one new object
  });
  ```

  The script then prints `group hf-mint: ok` and `user hf-read@pve: ok` and its only writes
  are the role, the new user and its grant. A test runs exactly that against the CLI fake,
  with the one-shared-comment run beside it as a negative control.

  Also:

  - Each comment is checked like `comment` was, and a problem is **named by where the value
    came from** — a bad shared `comment` is still one problem called `comment`, not three
    called after overrides the caller never passed.
  - `readComment` goes with its lane: a `null` `readUser` drops the user, so the field is
    neither used nor checked.
  - `:` joins the characters a comment may hold. It is special in neither `sh` nor a Perl
    `q{}`, and it is how real mint-user comments are written (`mint target: read`).
  - `CoreProvisionNames` is the six names `PROVISION_DEFAULTS` resolves, split out so that
    type keeps its exact shape; `ProvisionNames` extends it. `ProvisionComments` is the
    resolved comment per object. Both are exported.

- [#102](https://github.com/taslabs-net/homeflare-kit/pull/102) [`4fb005e`](https://github.com/taslabs-net/homeflare-kit/commit/4fb005e4892f34bbcef01c5227d464ae36e80299) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Vendor schema constraints, generated and enforced at plan time. `homeflare-proxmox`'s first
  `deploy:pbs` adopted ten objects and then failed its one create on `PVE POST config/verify -> 400:
parameter verification failed - comment: value may only be 128 characters long`. Nothing local
  caught it, because the only place the number 128 existed was PBS's published schema: the generated
  types keep `type`, `enum` and `optional` and drop every `maxLength`, `minLength`, `minimum`,
  `maximum` and `pattern` the vendor states.

  A new `codegen/` reads the cluster's own `apidoc.js` and emits machine-readable constraint tables
  (`packages/alchemy/src/proxmox/generated/constraints/`, one file per vendor area, all inside the
  250-line house cap). `constraints.ts` is a pure validator over a form and its endpoint's table, and
  `resource.ts`'s shared `pveHandlers` runs it on both the create form and the update form — so every
  family that declares an `endpoint` gets it, with no per-resource copy. `Pbs.Datastore`, which writes
  its own handlers, gets the same check through `pbs-datastore-endpoint.ts`. Nineteen families are
  wired, covering 37 endpoints: PBS datastore/prune/sync/verify/matchers, PVE acl, groups, roles,
  users, backup, firewall aliases, HA resources and rules, matchers, replication, SDN vnets and zones,
  pools and storage. Presence of a vendor-required parameter is checked on CREATE only — an update
  form is partial by design.

  Provenance is committed with it. `codegen/manifest.json` records each schema's vendor, product,
  version as the host reports it (pve-manager 9.2.11, proxmox-backup-server 4.2.6-1), source host
  ROLE and absolute path, sha256, byte size and fetch time; every generated header names its manifest
  entry, version and sha256 prefix. The raw 5.8 MB blobs stay out of git in a documented cache
  directory, and the generator refuses to run when a cached file's sha256 does not match.
  `tests/schema-manifest.test.ts` recomputes the tables' digest on every run and, when the cache is
  present, runs `bun codegen/constraints.ts --check` so a stale generation fails with the exact
  refresh command. The two UniFi OpenAPI documents (Network 10.4.57, Site Manager 1.0.0) are recorded
  as available and consumed by nothing — there is no UniFi provider family yet.

  ⛔ Patterns are translated through a whitelist, not copied. Measured over both whole schemas: PBS
  prints its Rust regex through `Display`, so every PBS pattern arrives wrapped in slashes, and it
  uses POSIX classes — `new RegExp` accepts `/^[[:^cntrl:]]*$/` and `[[:^cntrl:]]` SILENTLY and means
  something else in both cases, which would have refused every legal comment. PVE's `(?^:…)` throws.
  Anything the whitelist cannot carry over faithfully is recorded verbatim as `patternSource` and left
  unenforced, including PVE's 216 server-side `format` validators and PBS `schedule`, which publishes
  no pattern at all.

  `resource.ts` is split: the `PveSpec` shape and its argument move to `resource-spec.ts` (re-exported,
  so no importer changes) to keep both files inside the house cap.

### Patch Changes

- [#103](https://github.com/taslabs-net/homeflare-kit/pull/103) [`173b736`](https://github.com/taslabs-net/homeflare-kit/commit/173b7365742921bfde6f3a3114fca22ff7978c46) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Proxmox.Lxc`'s guide now says what a container's **inside** is, and pins it with a test.

  `Proxmox.Lxc` declares the keys in `/nodes/{node}/lxc/{vmid}/config` and nothing within the guest's
  filesystem. Every consumer that meets that limit goes looking for the resource that must surely
  exist — an exec, a file write, a cloud-init. **For containers it does not exist in PVE's API at
  all.** QEMU VMs have `POST …/qemu/{vmid}/agent/exec`, `…/agent/file-write`, `…/agent/file-read` and
  a `cloudinit` subtree; the complete `/nodes/{node}/lxc/{vmid}/…` endpoint set has no counterpart.
  The only reach inside is `termproxy` / `vncwebsocket`, an interactive console for a person.

  - `docs/proxmox-lxc.md` gains that table under **Gaps**, and says plainly that a generic,
    vendor-API-based Resource for a container's interior cannot be written: there is nothing to
    wrap. What is left, in the order that keeps a change declarative — bake it into the template
    (⚠️ `ostemplate` is create-only, so changing it REPLACES the guest), a first-boot artifact, or a
    recorded one-time human step named as undeclared.
  - ⛔ It also says why an exec-over-SSH resource is not option zero: it needs a credential and a
    network path _to the guest_, so when the guest is what provides credentials, naming or reach to
    others, it inverts the bootstrap — the new system's first boot depends on its own output. The
    `HostRunner` seam in `@homeflare/alchemy/launchd` is where such a runner plugs in, and the kit
    ships only `localRunner()` and `sudoRunner()` on purpose.
  - ⚠️ **Sibling families are not at parity.** QEMU and LXC sit under the same `/nodes/{node}/…` tree
    with completely different reach; the guide now says not to infer one from the other.
  - `src/proxmox/lxc-interior.test.ts` checks this against the generated schema on every run, so it
    fails the day PVE adds such an endpoint — which is exactly when the kit would want to wrap it.
    Its positive control asserts QEMU's three are present, so a change to the generated file's shape
    fails the test instead of making every absence assertion pass for free.

  Docs and a test only. No resource, type or behaviour changed.

- [#105](https://github.com/taslabs-net/homeflare-kit/pull/105) [`b1e4af3`](https://github.com/taslabs-net/homeflare-kit/commit/b1e4af38b2bf71986bb8b85974aa432e3b30ec99) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Generated Proxmox API coverage report, with provenance.

  `docs/api-coverage.md` and `docs/api-coverage.json` map every PVE and PBS endpoint that can
  create, update or delete state to the Resource that owns it, or to nothing — derived from the
  vendor schemas named in `schemas/manifest.json` (product version, source host role, sha256, size,
  fetch time), not hand-counted. PVE `pve-manager/9.2.4/5e5ae681198514d4`: 88 of 335 write
  endpoints owned. PBS `proxmox-backup-server 4.2.6-1`: 27 of 182.

  Each row also names the parameters carrying a vendor `maxLength`, `minLength`, `minimum`,
  `maximum`, `pattern` or `format` that nothing local enforces — 545 on the PVE endpoints we own and
  144 on the PBS ones, including the `comment` on `POST /config/verify` whose 128-character limit
  failed a `Pbs.VerifyJob` create at apply time.

  Regenerate with `bun run api:coverage`; `--check` exits 1 when the committed report is stale.
  `tests/api-coverage.test.ts` fails if a Resource claims an endpoint the schema no longer has, if a
  path the source calls unreachable turns out to exist, or if the report has been hand-edited. No
  package code changed.

## 0.14.0

### Minor Changes

- [#98](https://github.com/taslabs-net/homeflare-kit/pull/98) [`89ce4fd`](https://github.com/taslabs-net/homeflare-kit/commit/89ce4fdf606d6cc6e635164f0413b4ca6187379f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **New subpath: `@homeflare/alchemy/github` — one repository's merge policy in one call.**

  - `declareRepoPolicy(id, options)` declares a `GitHub.Repository` and a `GitHub.Ruleset` over its
    default branch: squash-only merges, auto-merge, head branches deleted on merge, no branch
    deletion, no force pushes, and the status-check contexts you name required with
    `strict_required_status_checks_policy` off. Both resources retain; `adopt` is piped only when
    asked. Generic and parameterized — `rulesetName`, `include`/`exclude`, `bypassActors`,
    `enforcement`, `baseUrl` (applied to both resources or to neither), and a `settings` bag for
    everything that is not merge policy, merged underneath so it cannot re-open a merge method.
  - `repoPolicy(options)` is the same policy as two plain prop objects, pure and type-only, for a
    test or a stack that wants to declare the resources itself.

  What it refuses, because each of these failures is silent:

  - ⛔ **Auto-merge with nothing to wait for merges the pull request immediately.** Auto-merge is
    a queue only while something is outstanding, and three inputs produce "nothing
    outstanding": no `checks` and no `requiredApprovals`; an `enforcement` that is not `active`
    (the rules are listed and none of them block); and an explicitly empty `include` (the ruleset
    matches no ref while GitHub still shows it as active). A required review counts as outstanding,
    so `requiredApprovals` with an empty `checks` is allowed. `checks: []` alone is accepted only
    alongside `autoMerge: false` — the honest description of a repo with no green run to require yet.
  - ⛔ **A blank check context** is refused: GitHub stores it and no job ever reports it, so every
    pull request waits on a check that cannot come.
  - ⛔ **`requiredApprovals: 0` is refused rather than treated as "no reviews".** Zero approvals is
    the solo-maintainer shape and needs `require_extra_approval_for_unattributed_changes: false`,
    which `alchemy@2.0.0-beta.79`'s `Ruleset` cannot send and GitHub defaults to `true`. Omitting
    `requiredApprovals` declares no `pull_request` rule at all, which is a different and honest
    thing.

  ⚠️ **The ruleset half cannot adopt.** Alchemy's `Ruleset` reports nothing without prior state and
  creates unconditionally, and GitHub allows two rulesets with one name — so a first deploy onto a
  repository that already has one adds a second, both enforcing. `GitHub.Repository` does not share
  the problem. Check `gh api repos/<owner>/<repo>/rulesets` first, or pass your own `rulesetName`.
  See `docs/repo-policy.md`.

### Patch Changes

- [#101](https://github.com/taslabs-net/homeflare-kit/pull/101) [`2e43257`](https://github.com/taslabs-net/homeflare-kit/commit/2e4325741b1264feb4069712e2da1dc28c7f9ac3) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `repoPolicy` refuses two more ways to build a ruleset that matches no ref: a blank ref
  pattern (`include: ['   ']` has length 1, so the empty-array guard passed it) and an
  `exclude` that cancels every `include` (exclusions win in a GitHub ruleset, so it reads
  as a narrowing and acts as an off switch). Both produced an `active` ruleset over nothing
  with `allowAutoMerge: true` — the end state the auto-merge guard exists to prevent.
  Include and exclude patterns are now trimmed, de-duplicated and sorted like `checks`.

  `docs/repo-policy.md` also records, measured against live GitHub rather than inferred,
  that the ruleset half never plans a no-op, and that its `rules` and `bypass_actors` are
  replaced wholesale rather than merged.

## 0.13.0

### Minor Changes

- [#95](https://github.com/taslabs-net/homeflare-kit/pull/95) [`4fc9a38`](https://github.com/taslabs-net/homeflare-kit/commit/4fc9a38d5f2f9513d75edad99edaf8b9005afc30) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Proxmox notifications that page. `@homeflare/alchemy/proxmox` adds three adopt-capable families and
  a webhook body:

  - **`PbsNotificationTarget`** — PBS `webhook`, `smtp` and `sendmail` targets. Secret fields are
    **write-only**: a webhook `secret`, the smtp `password` and any credential-bearing `header` are
    declared as `{ fromEnv: 'VARIABLE' }` and read by the deploying process at call time. No value
    reaches Alchemy state — the store keeps names, a fixed-salt scrypt digest of the live headers, and
    a random-salt seal of what the provider last wrote. A plan diffs on those (hash or presence), a
    plan without the variables is presence-only, a rotated value is PUT alone, and a write that needs
    a missing variable fails by the variable's name before any request.
  - **`PbsNotificationMatcher`** and **`ProxmoxNotificationMatcher`** — `match-severity`,
    `match-field`, `match-calendar`, `targets`, `mode`, `invert-match`, `comment`, `disable`. A matcher
    is compared as its whole rule; both built-in `default-matcher`s adopt as-is with no write.
  - **`alertmanagerAlertBody()`** — a PBS webhook body template that posts one Alertmanager v2 alert
    (`/api/v2/alerts`; labels `alertname`, `severity`, `source`, `job_type`, `job_id`, `datastore`,
    `hostname`; annotations `summary`, `description`). Every value goes through `json`, and every
    optional field is guarded, so a GC failure (no `job-id`) and the UI's field-less Test notification
    both render valid JSON.
  - `FromEnv` is exported. The PVE and PBS generated API types now cover the notification endpoints
    and matchers, and the shared PVE read treats a `{"data": null}` answer as absent instead of
    throwing.

  Guide: `docs/pbs-notifications.md`.

### Patch Changes

- [#97](https://github.com/taslabs-net/homeflare-kit/pull/97) [`1c746d2`](https://github.com/taslabs-net/homeflare-kit/commit/1c746d26334444d8ef8270fcba857035391b11e0) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Pbs.NotificationTarget` now refuses a literal credential in a plain prop, and does so at plan,
  before anything is stored.

  - The target refuses an `Authorization`, `Proxy-Authorization` or `Cookie` header, a header or URL
    query parameter named like `token`, `key`, `secret`, `password` or `signature`, and a password in
    the URL's userinfo. Each must be declared `{ fromEnv }` or read `{{ secrets.<name> }}`. Before
    this change, such a value planned, deployed, and stayed in the state store. A target already
    deployed that way now fails its plan until the literal is moved; the next deploy then replaces
    the stored props.
  - Refusals now run in Alchemy's adoption probe as well as in `diff`. A new target used to be
    refused only in `reconcile`, after Alchemy had already committed its props to state.
  - `alertmanagerAlertBody()` refuses a `generatorURL` that is not an absolute http(s) URL.
    Alertmanager rejects the whole post for one.
  - Docs: `docs/pbs-alertmanager-body.md` shows the exact template text. The old block had been
    reflowed by the formatter. PVE's per-matcher read needs `Mapping.Audit` or `Mapping.Modify`;
    `Mapping.Use` is not enough.

## 0.12.0

### Minor Changes

- [#90](https://github.com/taslabs-net/homeflare-kit/pull/90) [`de65267`](https://github.com/taslabs-net/homeflare-kit/commit/de652677804581b1dd431d3930d6656ac760037f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **New: the provisioning baseline, one description for every cluster and node.**
  `@homeflare/alchemy/proxmox` now exports:

  - `PROVISION_PRIVILEGES`: the provision role's 27 privileges as one sorted, frozen constant. It is
    the union of what every family's reconcile needs, including what the lane needs to manage the
    baseline itself.
  - `PROVISION_DEFAULTS` and `provisionBaseline(names)`: generic names (role `HfProvisioner`, users
    `hf-provision@pve` and `hf-read@pve`, group `hf-mint`, read role `PVEAuditor`), overridable per
    site. Names that are not PVE-shaped or would need shell quoting are refused.
  - `declareProvisionBaseline(id, target, names?, { adopt? })`: declares the role, the mint group,
    one user per lane (its group membership included) and the grant for each lane on `/`. Every
    resource retains, and `adopt` is piped only when asked.
  - `provisionBootstrap(names?)`: a pure generator of the one-time root commands for a new cluster
    or node, as a POSIX `sh` script. It checks each object before changing it, so it is idempotent,
    and it never creates a token or sets a password.

  The provision lane cannot create itself, so root bootstraps it once, then the stack adopts it and
  keeps it. After the bootstrap, the declaration is a clean adoption that writes nothing. See
  `docs/provision-baseline.md`.

### Patch Changes

- [#89](https://github.com/taslabs-net/homeflare-kit/pull/89) [`94fbc2f`](https://github.com/taslabs-net/homeflare-kit/commit/94fbc2f0f8471e64164b4c77418140c0fcf28cce) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The adopt verifier's guide now says what `alchemy drift` does in alchemy 2.0.0-beta.79. It has no dry run and no `--yes`, although its docs page lists one: `alchemy drift --yes` fails with `Unrecognized flag`. A non-interactive run prints the repair plan and exits `0` even when something drifted, so it cannot gate a deploy. `--repair` restores the props saved at the last deploy, not what the code declares now, and it writes without a prompt, outside the deploy gate. The ownership guide now says that recovering from a wiped state store, or from `alchemy state delete`, needs `--adopt` for every family that follows the ownership rule, and for `MeshNode` and `R2BucketLock`. Alchemy's docs say objects with no ownership marker re-import without the flag, but many of Alchemy's own marker-less providers refuse them too, as the kit does. The exceptions are a `CaddyConfig` running the declared config, and the families whose `read` never answers `Unowned`: the `pveHandlers`, `forgejoHandlers` and Talos resources.

- [#94](https://github.com/taslabs-net/homeflare-kit/pull/94) [`745d941`](https://github.com/taslabs-net/homeflare-kit/commit/745d94161b5cdd63c8d8ebd40a730c8b8b931ff7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Docs only. The changelog marks 0.9.0 as never published (no npm version, no git tag): its changes first shipped in 0.10.0, and the README, the openbao README and the ownership guide now say so where they cite 0.9.0. The `Proxmox.Storage` header no longer says the estate's provision role lacks `Datastore.Allocate`: it was widened, and the provisioning baseline carries it.

- [#93](https://github.com/taslabs-net/homeflare-kit/pull/93) [`d3c332b`](https://github.com/taslabs-net/homeflare-kit/commit/d3c332bd4f175cc3510b7ae06ff98f4b426f0c52) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The published sources, docs and examples no longer name the maintainer's own infrastructure.
  Node names, cluster and pool names, NICs, VLANs, addresses, hostnames, guest ids, principals and
  policy names in comments, fixtures and examples are now neutral placeholders: nodes `node-a`…
  `node-d`, a reference cluster `C1`, documentation addresses (RFC 5737), `bao.example.internal`.
  Measured facts are unchanged; only the names are. `site.example.json` names its hosts `node-a`…
  `node-c`. One runtime message changed: `forgejo-bootstrap` now says to run on "the host where
  Forgejo runs". The historical CHANGELOG entries are unchanged.

## 0.11.0

### Minor Changes

- [#87](https://github.com/taslabs-net/homeflare-kit/pull/87) [`520926f`](https://github.com/taslabs-net/homeflare-kit/commit/520926fd81230025bb5337a2b0ea72992c0ccf7f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **Breaking: a `ProxmoxLxc` adoption never changes a guest.** When a guest is adopted — found by
  the adoption probe with no state, or an interrupted create resumed under `--adopt` that the plan
  could not prove its own — any key the declaration says otherwise now FAILS the plan, naming the
  keys and never their values:

  ```
  CT 100 on pve1: adopting it would change memory, net1. An adoption never changes a guest, so
  nothing is written. …
  ```

  Only an exact match adopts, and its deploy writes nothing. Before, such a plan said `adopted`,
  only logged the keys as a warning, and `deploy --adopt --yes` wrote them. The deploy asks again
  against a fresh read, so a hand edit between plan and deploy is refused rather than written back.
  To change a guest, adopt it as it runs first; the change is then an ordinary `update`. The
  ownership rules are unchanged: nothing is adopted without `--adopt` or `adopt(true)`, and an
  interrupted create proven its own still resumes and writes. See `docs/proxmox-lxc-adopt.md`.

## 0.10.1

### Patch Changes

- [#85](https://github.com/taslabs-net/homeflare-kit/pull/85) [`61249dc`](https://github.com/taslabs-net/homeflare-kit/commit/61249dce57ec7a3ba319246074ba7e431a9927fc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **Fix: `hf-adopt-verify` no longer passes a drifted adoption whose provider's `diff` never looks at
  the live object.** Alchemy gives an adopted row's `diff` the declaration as its recorded props, so
  a diff that compares recorded props with the declaration says `noop` whatever the cloud holds.
  Alchemy's own `Cloudflare.R2Bucket` diff works that way. The verifier printed `ok` and exited `0`
  while listing the drift under `changed`, and the deploy then wrote it. Now an adopted `noop` with
  something under `changed` gets its `diff` run a second time, with the live values of those fields
  passed as the recorded props (still read-only, and write paths are still refused). A second
  `noop` passes with a note that the family does not manage those fields. Any other answer fails
  the row. The answer appears as `recheck` in the JSON report. No kit PVE/PBS family is affected:
  each one's `diff` re-reads the cluster.

  **Fix: the default report no longer hides a `create` when a rename hands its old id to a new
  resource.** A row now counts as stateful only when it plans from the state row it reads, rather
  than any row that happens to sit at its FQN.

## 0.10.0

### Minor Changes

- [#84](https://github.com/taslabs-net/homeflare-kit/pull/84) [`eb2fd8b`](https://github.com/taslabs-net/homeflare-kit/commit/eb2fd8b0a7f332731316ceedfa9af3a619616e95) Thanks [@taslabs-net](https://github.com/taslabs-net)! - ⚠️ **BEHAVIOUR CHANGE — three silent takeovers in 0.9.0's ownership rule closed, and `sudoRunner()`
  refuses more.** Found by an adversarial review of 0.9.0, each measured through Alchemy's own plan
  and apply before the fix, and each now refused, writing nothing. It narrows two 0.9.0 notes: crash
  recovery without `--adopt` needs a row that can prove the object ours, and `--adopt` at apply
  never covers a fresh replace's new generation.

  - **A `Bao.*` create killed before its ownership check no longer resumes onto someone else's object.**
    Apply writes the `creating` row before `reconcile` runs, and drops any prop still an `Output`
    from it. With the name an Output, the next deploy "resumed" that create and wrote over another
    owner's role (all nine role and MFA families, and `Bao.Mount` by path). With a knob an Output,
    `Bao.Mount` and `Bao.AuthMethod` read the missing prop as "not managed", adopted another owner's
    mount and tuned it. A state row now proves an object ours only when it carries every value the
    declaration names, and a resume is let through only when the family's own `read` proves the
    object that generation's — for every `Bao.*` family and `ProxmoxLxc`. **So a create killed
    while a prop was still an Output now needs `--adopt` to resume.**
  - **An interrupted `Bao.*` replace no longer writes over what another owner put at its new
    identity since**, unless `--adopt`.
  - **`--adopt` at apply now covers a create or an interrupted generation, never a fresh replace's
    new generation**, for every `Bao.*` family, `HostFile` and `LaunchdJob`. The planner never
    offers adoption there, yet a deploy-wide `--adopt` let a `HostFile` whose path changed overwrite
    a file it did not own at the new path.
  - **`sudoRunner()` also refuses** (⚠️ a prefix 0.9.0 accepted can now fail): a directory _above_ the
    prefix, from `/` down, that root does not own alone (whoever may write the prefix's parent can
    swap the prefix itself; a root-owned symlink such as `/etc` is still followed), and any ACL entry
    from `/` down to the file that grants a write right (read with `ls -lden`, as the operator; deny
    entries pass; unreadable ACLs refuse). Both run before sudo and, through `checkWrite`, at plan
    time.

  `docs/ownership.md` and `docs/launchd-sudo.md` carry the details and the limits.

- [#83](https://github.com/taslabs-net/homeflare-kit/pull/83) [`01c54cf`](https://github.com/taslabs-net/homeflare-kit/commit/01c54cfcf3892388369e4c01765ca5f69d843e8b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **New: `hf-adopt-verify` and `@homeflare/alchemy/verify` — prove a deploy's adoptions are no-ops
  before it runs.** Alchemy prints `adopted` for an object that already matches and for one that
  drifts alike (beta.79 `Plan.ts` turns the diff's `noop` into an update after the adoption probe),
  and the deploy reconciles both. The verifier plans the stack with Alchemy's own planner, with
  every provider watched and every write path refused. For each row without a state row it reports
  the provider's `read`, its own `diff` before the engine forced it, and the declared fields that
  differ (names only). It exits `0` only when all are no-ops, `1` when any is not, `2` when the plan
  could not be computed.

  ```sh
  bunx --bun hf-adopt-verify --config alchemy.run.ts --stage live [--all] [--json]
  ```

  `verifyStack(target)` and `verifySession({ stack, context })` are the same thing as functions.

  **Fix: adopting a `Proxmox.CephPool` that already matches no longer writes.** Its reconcile PUT
  `setpool` whenever the pool existed, so every adoption forked a `cephsetpool` worker under the
  provision token. On TB4 that was six tasks, one per pool, on 2026-09-13 and 2026-09-20. It now
  skips the PUT when its own `matches` holds, like every other PVE/PBS family. The predicate is
  shared in one place (`update-guard.ts`). `docs/adopted-deploys.md` traces what a deploy of an
  adopted row does for every family the Proxmox and PBS stacks use.

- [#80](https://github.com/taslabs-net/homeflare-kit/pull/80) [`66d9374`](https://github.com/taslabs-net/homeflare-kit/commit/66d937416287b8b657da4091eecdd3824666087a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `@homeflare/alchemy/proxmox` now exports `ProxmoxLxc` as a Resource. It declares a Proxmox VE container: you can adopt one that runs today, or create one from a template.

  - **The props are PVE's own keys and spellings**, taken from `/nodes/{node}/lxc/{vmid}/config`: `hostname`, `cores`, `memory`, `swap`, `rootfs`, `mpN`, `netN`, `devN`, `features`, `unprivileged`, `onboot`, `startup`, `description`, `tags`, and the rest. To adopt a guest, paste its `pvesh get` output. An undeclared key is unmanaged. A key declared as `''` is removed, where PVE allows that. `password`, `ssh-public-keys` and `env` are typed `never`.
  - **Values are compared as PVE stores them.** Key order and written-out defaults are ignored. A MAC PVE generated is ignored, and a NIC write keeps the live MAC. `storage:GiB` equals the volume it allocated. An existing volume is always written back with its live volume id.
  - **Changes are made in place.** Config changes use one `PUT …/config` carrying the config `digest`. A larger disk uses `PUT …/resize`. Create, resize and delete wait for their PVE task. If nothing differs, nothing is written, including on the first deploy after an adoption.
  - **Nothing plans a replace.** These changes fail the plan with a sentence, and nothing is written: a new `vmid`, a `node` the guest is not on, another `ostemplate`, an `unprivileged` flip, a smaller disk, another storage, or detaching a mount point.
  - **Keys only root@pam can write are refused at plan.** These are `devN`, bind or device mounts, features other than `nesting`, and any feature on a privileged guest. PVE never treats an API token as `root@pam`, so the refusal prints the `pct set` to run on the node instead.
  - **A read failure is not "absent".** A config read counts as absent only when it answers 500 and the cluster lists the vmid nowhere. Any other failure fails the plan. A vmid held by another node, or by a QEMU VM, fails the plan and says where it is. After HA or `pct migrate` has moved a guest, setting `node` to where it is now is an update that writes nothing.
  - **Nothing is adopted without `adopt(true)` or `--adopt`, not even a guest that matches the declaration.** This is the rule of `docs/ownership.md`, which every `Bao.*` family, `HostFile` and `LaunchdJob` follow. Matching is not proof of ownership: once state claims a guest, `RemovalPolicy.destroy()` deletes it and its volumes. Without adoption on, the plan fails with "Cannot adopt". A create interrupted after its POST still resumes without `--adopt` when the guest matches what it declared.
  - **An adoption's plan always says `adopted`.** Alchemy prints no diff for it, so a warning names each key a deploy would write.
  - **A create only ever allocates.** A create naming an existing volume id (rather than `storage:GiB`) is refused, because PVE would unpack the template onto that volume; so is any key the resource does not manage. A deploy that planned a create never takes over a guest it then finds at that vmid. Without adoption on, it fails and forgets its `creating` row. With it on, a matching guest is recorded with no write and any other is refused. A guest the cluster lost while state still holds it plans `update` with a warning that the deploy creates it again, or fails the plan when it cannot be created.
  - **State keeps managed keys only.** The `config` attribute is an allowlist, so a key a newer PVE adds (such as `entrypoint`) is not stored.
  - **It retains by default.** Dropping the declaration leaves the guest running. Only `RemovalPolicy.destroy()` deletes it, only while the guest still matches its last declaration, and it never forces the delete or stops the guest first.

  Breaking, for anyone who deep-imported the old provider-only version: `storage` is gone (declare `rootfs: 'storage:GiB'`), `ostemplate` is optional, the attributes are now `{ node, vmid, config, rawKeys }`, and `hostname` no longer defaults to `ct<vmid>`. The guide is `docs/proxmox-lxc.md`.

### Patch Changes

- [#82](https://github.com/taslabs-net/homeflare-kit/pull/82) [`462368f`](https://github.com/taslabs-net/homeflare-kit/commit/462368fa263ef541bac7c0e70070fb656b4fcda7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The ownership and `ProxmoxLxc` guides now say how to read an adoption's plan before it writes. `alchemy plan` has no `--adopt` flag in alchemy 2.0.0-beta.79, so without adoption on it stops at "Cannot adopt" before any resource can warn what taking the object over would write. Run `alchemy deploy --adopt --dry-run` instead, or declare `.pipe(adopt(true))` and run `alchemy plan`. The LXC guide also warns that a drift warning does not stop the deploy: `deploy --adopt --yes` writes a `net0` declared without the live `tag=` without it, and the guest leaves its VLAN.

## 0.9.0

> ⚠️ Never published: no npm version and no git tag. These changes first shipped in 0.10.0.

### Minor Changes

- [#78](https://github.com/taslabs-net/homeflare-kit/pull/78) [`8de1015`](https://github.com/taslabs-net/homeflare-kit/commit/8de1015993f147ffb2f88116204cba6efb449268) Thanks [@taslabs-net](https://github.com/taslabs-net)! - ⚠️ **BEHAVIOUR CHANGE — `@homeflare/alchemy/openbao` no longer adopts anything silently.** Until
  0.8.0, every `Bao.*` family adopted a live object it had no state for: a new declaration of a
  policy, role, mount, auth method, plugin or MFA object that already existed was taken over, and
  rewritten, without being asked. **A stack that relied on that must now add `adopt(true)` to those
  resources, or deploy once with `--adopt`.** Otherwise its next plan fails with
  `OwnedBySomeoneElse` ("Cannot adopt resource … Re-run with `--adopt`").

  - **Every `Bao.*` family (all 14).** With no state row, a live object reads as `Unowned`, even when it
    is identical to the declaration. Identical is not proof of ownership: under `destroy`, the old
    owner's delete would remove the object the new declaration had just claimed. The plan fails
    unless adoption is on. This is the rule `HostFile`, `LaunchdJob` and `CaddyConfig` already
    follow. The 0.8.0 swap (a new logical id for a live name, then the old id's delete) now fails the
    plan and writes nothing.
  - **Crash recovery still works without `--adopt`.** Alchemy's recovery read for an interrupted
    create carries that row's own instance id, and the object is ours when it also matches the row's
    props. An interrupted replace resumes through a note that its `diff` leaves for the apply. A
    create interrupted between two writes (a mount enabled but not tuned) is not proven ours, so it
    needs `--adopt`.
  - **The same check at apply.** Alchemy skips the probe while a prop is still an Output, and never
    probes the new generation of a replace. Each family's `reconcile` now reads the object first and
    refuses the takeover before any write, unless `--adopt` or the resource's own `adopt(…)` allows
    it, resolved as the planner resolves it. A refused create also forgets the `creating` row Apply
    wrote, so the next plan does not adopt what the apply refused. A `BaoMount` / `BaoAuthMethod`
    create with `remountFrom` refuses to move a live mount the stack holds no state for.
  - **`HostFile` and `LaunchdJob`: `--adopt` now works at apply.** Their `reconcile` refused a
    foreign file or job even under `--adopt`, where the probe had been skipped. A create now takes it
    over when adoption is on. `adopt(false)` still wins over the flag. A rename onto an occupied
    path or label stays refused.
  - **`sudoRunner()` refuses more, before sudo** (⚠️ a declaration that 0.8.0 accepted can now fail):
    - a root-owned file under a prefix that would be group- or world-writable, setuid or setgid
      (`mode & 0o6022`; an omitted owner is root);
    - any directory between the prefix and the file that root does not own, or that group or other
      may write. Before, only the prefix itself was checked.
    - A `HostFile` or `LaunchdJob` plan that will write now runs these checks too, through the new
      optional `HostRunner.checkWrite`, so the refusal fails the plan instead of the apply. It only
      reads, as the operator: a plan still never calls sudo.

  New: `docs/ownership.md` (the rule, where it is checked, recovery, limits). `docs/launchd-sudo.md`,
  `docs/launchd.md` and the openbao README and REPLACE.md are updated.

## 0.8.0

### Minor Changes

- [#74](https://github.com/taslabs-net/homeflare-kit/pull/74) [`cd6d437`](https://github.com/taslabs-net/homeflare-kit/commit/cd6d437c134ca726a6d6ca5b28053ed01a2762e6) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Rename safety for the other nine name- or catalog-keyed families in `@homeflare/alchemy/openbao`: `BaoAuthRole`, `BaoPkiRole`, `BaoJwtRole`, `BaoKubernetesRole`, `BaoJwtAuthConfig`, `BaoMfaTotpMethod`, `BaoMfaLoginEnforcement`, `BaoSshRole` and `BaoPlugin`. They now get the same checks as `BaoPolicy`, `BaoCloudflareRole` and `BaoProxmoxRole`, through one shared helper.

  Behaviour changes:

  - A rename or move onto a name, path or catalog entry that already exists now fails the plan, before anything is written. Before, two roles that swapped names under `RemovalPolicy.destroy()` both planned `replace`, and a green deploy deleted both of them. This happened for `BaoAuthRole`, `BaoPkiRole`, `BaoJwtRole`, `BaoKubernetesRole`, `BaoSshRole` and `BaoPlugin`. It also applies under `retain`: a swap now takes two deploys through a free name. For `BaoPlugin` it includes a version bump onto a version already registered by hand. For `BaoJwtAuthConfig` it includes a move onto a mount whose config is already set.
  - The name or mount is now checked while other props are still pending Outputs. Before, a rename in the same deploy as any pending Output planned `update`, and the old object stayed live with no state record. For `BaoMfaTotpMethod` that wrote a second method. Its rename is now refused at plan in that case too.
  - When the name itself is an Output not known until apply, reconcile now refuses the `update` before writing anything. The next deploy plans `replace`, or, for `BaoMfaTotpMethod`, refuses the rename.
  - `BaoKubernetesRole` and `BaoJwtRole` compare names lowercased, as OpenBao keys them, so a change of case is not a move. Both still refuse an upper-case name.
  - `hostAppRoles` now lets a host sit in several classes, with one role per class. It only refuses the same host listed twice in one class. Before, any host listed twice was refused.
  - `hostAppRoles` refuses a host whose class names an inherited object key such as `constructor`. Before, that host passed as a class with no policies and no `secretIdTtl`, and got a role whose secret_id never expires.

  Documentation: a new logical id for a name that is already live adopts it, and under `RemovalPolicy.destroy()` the old id's delete then removes it, in a green deploy. Change a logical id with Alchemy's `renamedFrom`, and take a name another resource is leaving in the deploy after the move (REPLACE.md). Also: deleting an AppRole role does not revoke the tokens it issued. OpenBao 2.6.2 deletes the role's secret_ids and role_id, so no new login succeeds, but issued tokens live to their TTL and only fail to renew. The `BaoAuthRole` comments said the delete revoked every token.

- [#75](https://github.com/taslabs-net/homeflare-kit/pull/75) [`85dd10c`](https://github.com/taslabs-net/homeflare-kit/commit/85dd10cd3fb16e9daf48592d21340449fb381b56) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `CaddyConfig` in `@homeflare/alchemy/caddy` no longer adopts a running Caddy silently. In 0.7.0, the first read adopted whatever config a Caddy was running, and the next apply loaded over it.

  Behaviour changes:

  - With no state, the first read is Alchemy's adoption probe. A Caddy whose running config is the declared one is adopted as-is, and nothing is loaded. A Caddy serving nothing (`null`, or no apps) plans a create. Any other config reads as `Unowned`, so the plan refuses it unless the deploy runs with `--adopt`. A Caddyfile that cannot be compared at probe time also reads as `Unowned`, with a warning saying why, never an error: the engine replays this read to recover an interrupted create, and an error would fail every later plan.
  - Where Alchemy skips that probe (props holding an Output, as on `caddyWithFile()`'s first deploy), the apply refuses the same takeover before any `/load` (the HostFile is written by then). It resolves adoption as the planner does: the resource's own `adopt(…)`, else `--adopt`. So `.pipe(adopt(false))` still refuses under `--adopt`, and `.pipe(adopt(true))` takes over without it.
  - The state vouches only for the Caddy it was applied to. When the transport now reaches a Caddy at another endpoint, the apply needs adoption (`--adopt`, or the resource's `adopt(true)`) unless that Caddy runs the config the state last stored, the declared one, or nothing.

  Docs: `docs/caddy.md` has the adoption table, and records that managed Caddies run `caddy run --resume` with their own `XDG_CONFIG_HOME`, set in the launchd job rather than the envfile. A restart then runs the last config Caddy accepted, and after a resumed start SIGUSR1 has no file to reload. The admin endpoint section moves to `docs/caddy-admin.md`, and the README's reasons for each peer and override pin move to `docs/peers.md`.

- [#77](https://github.com/taslabs-net/homeflare-kit/pull/77) [`9ec684c`](https://github.com/taslabs-net/homeflare-kit/commit/9ec684c612c5d9c0987b4e9ca462e1f683bf954e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `sudoRunner()` to `@homeflare/alchemy/launchd`, so a host stack can deploy as the operator
  instead of as root.

  - **Only the calls that need root use `sudo -n`, in fixed argv shapes.** These are
    `launchctl bootstrap | bootout | kickstart` in the system domain, and `install` / `rm` of a file
    under a prefix the stack declares. A file is written as the operator to a private `0600` temp
    file, then copied into place with `install -S -m <mode> -o <uid> -g <gid>`. Nothing else runs
    as root, and a plan never calls sudo.
  - **It is opt-in:** `launchdProviders(sudoRunner({ prefixes }))`. `localRunner()` stays the
    default and never elevates, and nothing falls back to sudo.
  - **It never prompts.** A password-required `sudo -n` fails at once with `SudoRefusedError`, and
    the message says to run `sudo -v` or to grant exactly these commands `NOPASSWD`.
  - **Each privileged argv is logged before it runs.** The log holds the argv only, never file
    content.
  - **These are refused before sudo is asked, with `SudoRefusedError`:** any argv outside the
    allowlist (such as a bare `bootout system`, a directory `bootstrap`, or a plist anywhere but
    `/Library/LaunchDaemons/<label>.plist`), a system `bootstrap` / `bootout` without
    `/Library/LaunchDaemons` among the prefixes, a prefix that is not a real directory only root may
    write, a path outside every prefix that needs root, a symlink between the prefix and the file, a
    file the operator could not read back, and another user's `gui/<uid>` domain.

  `docs/launchd-sudo.md` has the full list, the sudoers cautions, and the limits.

## 0.7.0

### Minor Changes

- [#72](https://github.com/taslabs-net/homeflare-kit/pull/72) [`294518d`](https://github.com/taslabs-net/homeflare-kit/commit/294518dc205c1981bf8f48aaf087bdb3869d4123) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Rename safety for `BaoPolicy`, `BaoCloudflareRole` and `BaoProxmoxRole` in `@homeflare/alchemy/openbao`.

  Behaviour changes:

  - A changed `name` on `BaoPolicy`, or a changed `mount` or `name` on `BaoCloudflareRole` or `BaoProxmoxRole`, now plans `replace`. Before, it planned `update`: the new object was written and the old one stayed live with no state record, even under `RemovalPolicy.destroy()`. Now the old one is deleted after the new one is written, or kept under the default `retain`, and the apply says so.
  - `BaoPolicy` compares names the way OpenBao stores them, trimmed and lowercased, so a change of case is not a rename.
  - A `BaoProxmoxRole` rename that also changes `mintUser` now fails the plan unless `allowMintUserChange` names the old mint user, the same rule an in-place re-scope already had.
  - A rename or move onto a name or path that already exists live now fails the plan, before anything is written. Without this, two policies or roles that swapped names under `RemovalPolicy.destroy()` both planned `replace` and ended with both deleted. The check also applies under `retain`, because a diff cannot see the removal policy: a swap, or a move back onto a retained old generation, now takes two deploys through a free name, or removing the target by hand.
  - When the new name is an Output that is not known until apply, reconcile now refuses the `update` before writing anything. The next deploy plans `replace`. A `BaoProxmoxRole` rename whose `allowMintUserChange` is still an Output defers the same way instead of failing the plan.

  The rename is checked even while other props are still pending Outputs. `src/openbao/REPLACE.md` has the measured engine behaviour and what `retain` leaves live for each of the three.

- [#70](https://github.com/taslabs-net/homeflare-kit/pull/70) [`8cafb48`](https://github.com/taslabs-net/homeflare-kit/commit/8cafb48d84a9734997d7562311801025f2fa4236) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add the `@homeflare/alchemy/caddy` subpath: a running Caddy's config, declared as Caddyfile text and applied through Caddy's own admin API.

  - `CaddyConfig` / `CaddyConfigProvider` (`Caddy.Config`): the whole Caddyfile as one prop. Apply is `POST /adapt` (validate), `POST /load` with `text/caddyfile` (graceful reload), then `GET /config/`, which must hash to the adapted config, or the deploy fails. When Caddy refuses a config, it keeps the old one, and the error gives Caddy's reason and confirms whether the old config is still running. This includes Caddy's refusal that arrives in a 200 response after adapter warnings. Drift compares SHA-256 digests of canonical adapted JSON: declared, live and stored. A hand edit or a restart with a different file plans an update. A plan-time `/adapt` fails the plan on a bad Caddyfile. With no state, a running Caddy is adopted. `replace` is never planned. Delete never unloads or stops Caddy, and `retain` is the default.
  - `caddyWithFile()`: the same Caddyfile is also written with launchd's `HostFile` to the file Caddy starts from, so a restart keeps it. The file is written first, then `/load`, and both are retained. `sourceFile` is sent as `Caddy-Config-Source-File` so SIGUSR1 reload-from-file keeps working. `docs/caddy.md` covers the order, `--resume`/autosave and the refused-config window.
  - `CaddyAdmin`, `localCaddyAdmin()`, `caddyAdminLayer()` and `caddyProviders()`: every admin call goes through one injectable transport. The local transport uses `node:http` on both Bun and Node, accepts only loopback `http://` or `unix://`, and sends `Host`/`Origin` the way the Caddy CLI does. `hostHeader` covers narrowed `origins` and SSH-forwarded ports. It retries only refused connections and then rejects with `CaddyUnreachableError`. A stopped Caddy does not fail the plan, because its launchd job may be the fix: read and diff plan the load with a warning, and the apply fails until Caddy answers.
  - Refused before anything is sent: an empty Caddyfile or one that adapts to no apps; literal secrets (a PEM key, a literal after `dns <provider>`, secret-named subdirectives, literal `Authorization` headers, token and password-hash shapes, and a `{$NAME:default}` whose default is one of these); and an adapted `admin` block that would turn the API off, move it off loopback or away from the transport (another port, socket or loopback address, or no address at all when the transport is not at Caddy's default), allow no Host the transport sends, set `enforce_origin` over a unix socket, enable `remote`, or pull config. Secrets go in `{env.NAME}` or `{file./path}` placeholders.

- [#71](https://github.com/taslabs-net/homeflare-kit/pull/71) [`73736ae`](https://github.com/taslabs-net/homeflare-kit/commit/73736aec0a686af36cb4ef7ecfba42d40e543fc7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `MeshNode` (`Cloudflare.MeshNode`) and `fetchMeshNodeToken` to `@homeflare/alchemy/cloudflare`.

  - **`MeshNode`** declares a Cloudflare Mesh node (a `warp_connector`) with `name` and `ha`. It never reads the node token, so the token never reaches Alchemy state. Alchemy's `Cloudflare.Tunnel.WarpConnector` fetches it on every read and stores it, and it has no `ha`. The attributes are `id`, `accountId`, `name`, `status` and `ha`.
    - A `name` change renames the node in place (`PATCH`), keeping its id, token and enrolled replicas.
    - `ha` is required and create-only (Cloudflare: "cannot be changed afterward"). A change replaces the node: delete-first while the name stays (names are unique per account), create-first when the name changes too. An account change is a create-first replace.
    - **It defaults to `RemovalPolicy.retain`**, like the kit's other resources whose deletion breaks their consumers: deleting a node cuts every enrolled replica off the Mesh, and a new one means a new token and Mesh IPs. Dropping the declaration or `alchemy destroy` leaves the node live. Opt in with `.pipe(RemovalPolicy.destroy())`.
    - Under that default a same-name `ha` change **refuses and writes nothing**: the engine keeps the old node, which still holds the name, and a create never reuses a node it did not create (that would record the wrong `ha`). The sentence names the ways on: deploy once with `.pipe(RemovalPolicy.destroy())` (delete-first), delete the old node by hand, or keep it (`alchemy state rm` the row, then `adopt(true)`; reverting `ha` alone refuses again). A create-first replace leaves the old node live. When a create-first replace's new name is already held by another node, the sentence does not call it the old node and says not to delete it. Every way back from inside a replace starts with `alchemy state rm`, because `adopt(true)` alone does not act on a `replacing` row; the 1013-retry sentence says so too. All measured through Alchemy's real plan/apply against the fake.
    - A door (a node with no routes) is documented as `ha: false`: HA fails over routes, and each replica has its own Mesh IP. A second door is a second `MeshNode`.
    - An existing node is adopted by exact name and returned `Unowned`. A create answered code 1013 after a clean lookup (distilled retries a create whose response was lost) names the node that appeared rather than blaming another tunnel type.
    - `list` is empty and `nuke` skips the type, because Alchemy's WarpConnector already lists every `warp_connector`.
  - **`fetchMeshNodeToken({ accountId, id | name })`** returns the node token `Redacted`, on demand, for a one-off enrolment step. Callers write it to a root-owned `0600` file on the node and nowhere else. An empty token fails, and a 403 names the Write permission the endpoint needs. Before any request it refuses the Global API Key, an empty API token, and a set `DISTILLED_DEBUG_HTTP` (distilled would print the token to stderr).
  - Built on `@distilled.cloud/cloudflare`, the SDK Alchemy's own Cloudflare providers use. The `cloudflare@4.5.0` SDK cannot create an HA node. It is a new **required peer**, pinned to the version alchemy pins (`1.0.0-rc.12`): add it to your install line.
  - `providers()` now also resolves Alchemy's Cloudflare credentials and account for `MeshNode`, the same way `Cloudflare.providers()` does (a profile, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

  Guide: `docs/mesh-node.md`.

## 0.6.0

### Minor Changes

- [#67](https://github.com/taslabs-net/homeflare-kit/pull/67) [`48163cf`](https://github.com/taslabs-net/homeflare-kit/commit/48163cfc83ad7deac8720be2e8fb7fe964ade7a3) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add to `@homeflare/alchemy/openbao`:

  - **`BaoJwtRole`**: roles on `jwt` and `oidc` mounts.
  - **`BaoKubernetesRole`**: roles on `kubernetes` mounts. `aliasNameSource` is required, because changing it on a live role moves every pod to a new entity.
  - **`BaoJwtAuthConfig`**: the non-secret config of a JWT-validating mount. It deliberately has no OIDC client secret, and it refuses a mount that has one, because its full-replace write would erase it.
  - **`BaoMfaTotpMethod`** and **`BaoMfaLoginEnforcement`**: login MFA. A TOTP method is found by name. Renaming one is refused, because a rename would strand every enrolled secret. A name already held by another MFA method type is refused too, because the write would convert that method. Deleting an enforcement is refused, because in OpenBao 2.6.2 the delete comes back after a restart (openbao/openbao#4030).
  - **`assertBaoIdentity`** (with `assertBaoIdentityEffect` and `BaoIdentityError`): refuses to proceed unless unauthenticated `sys/health` reports the expected `cluster_name` and the namespace is the expected one.
  - **`hostAppRoles`**: a pure generator that makes one AppRole per host, named `<class>--<host>`. It refuses a secret_id TTL of 0.

  Behaviour changes:

  - A changed `path` on `BaoMount` or `BaoAuthMethod` now **fails the plan** unless the new `remountFrom` prop names the old path. With `remountFrom`, the mount is moved with `sys/remount`, keeping its data (leases under it are revoked). Before, the plan answered `update` and enabled an empty mount at the new path.
  - A changed `name` on `BaoAuthRole`, or a changed `name` on `BaoPkiRole`, now plans `replace`. Before, it answered `update` and left the old role live with no state record.
  - `BaoPkiRole` now manages `requireCn`, `enforceHostnames`, `keyUsage`, `allowedDomainsTemplate`, `noStore` and `generateLease`, defaulting to OpenBao's own values. Its full-replace write already reset these fields silently, so a role whose live values differ from those defaults now plans `update` instead of being reset unseen. `noStore` together with `generateLease` is refused.

  See `src/openbao/REPLACE.md` for what every family does on a rename.

- [#68](https://github.com/taslabs-net/homeflare-kit/pull/68) [`b023bae`](https://github.com/taslabs-net/homeflare-kit/commit/b023bae8f20d6aa33239107dc0538750efc466ca) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add the `@homeflare/alchemy/launchd` subpath, so a Mac host can be declared with Alchemy.

  - `LaunchdJob` / `LaunchdJobProvider` (`Launchd.Job`): one launchd job in the `system` domain or a `gui/<uid>` domain. The provider renders the plist itself, writes it atomically to the derived path (`/Library/LaunchDaemons` or the user's `LaunchAgents`) and drives `launchctl`. Create bootstraps; update writes, boots out and bootstraps (a restart); read uses `launchctl print`; diff compares the rendered plist's SHA-256 with the stored and on-disk digests. Replace happens only on a `label` or `domain` change, delete-first — so everything the new job would be refused for is refused at plan time, while the old job still runs, and a rename is seen even while other props are unresolved. A label another job already holds is never booted out or overwritten. A failed first bootstrap removes the plist it wrote. A disabled label is refused, not re-enabled. Labels under `org.nixos.`, `com.apple.` and `homebrew.mxcl.` are refused; `docs/launchd.md` describes the nix-darwin cutover.
  - `HostFile` / `HostFileProvider` (`Host.File`): a text file with mode, owner and group. It is written atomically (temp file, then rename), diffed by SHA-256, mode and owner, and refused over a symlink, a directory, or a different file at a new path.
  - `HostRunner`, `localRunner()`, `hostRunnerLayer()` and `launchdProviders()`: every filesystem and `launchctl` call goes through one injectable runner. The local runner never elevates. System-domain writes are refused unless the deploy runs as root or the runner is explicitly `privileged`.
  - `renderPlist`: a small, deterministic XML plist serializer, round-tripped through `plutil` in the tests.

  Props are stored unencrypted in Alchemy state, so `environment`, `programArguments` and file `content` must not hold secrets. A tripwire refuses the obvious cases; secret files stay rendered by openbao-agent, and the stack declares only their path. Anything already on the host is read as `Unowned`, so it is never adopted without `--adopt`.

## 0.5.0

### Minor Changes

- [#64](https://github.com/taslabs-net/homeflare-kit/pull/64) [`3ed9771`](https://github.com/taslabs-net/homeflare-kit/commit/3ed977142ffe2fe6dd02359a3a87b1a0a84c9952) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `appRoleLogin` / `revokeSelf` (with `appRoleLoginEffect`, `revokeSelfEffect` and `BaoLoginError`) to `@homeflare/alchemy/openbao`, so wrapper scripts can log in with an AppRole and revoke on exit. They use the same address resolution and transport as the `Bao.*` families. The login never sends `BAO_TOKEN`, and error strings are redacted, because OpenBao 2.6.2 can echo a secret_id back in an error. `clientToken` is a getter over a private field, so printing or serialising the result does not show the token under Bun or Node.

  Add `BaoPlugin` / `BaoPluginProvider` for the plugin catalog (`sys/plugins/catalog/<type>/<name>`). It has no `env` prop and retains on destroy. It refuses to shadow a builtin or overwrite a declarative entry, and it names the fix when an unversioned registration is filed under the binary's self-reported version.

  Fix `BaoSshRole` writes. `default_extensions` and `default_critical_options` were sent as JSON strings. OpenBao's field validation rejects that with a 400, so every role write failed. They are now sent as objects.

## 0.4.1

### Patch Changes

- [#62](https://github.com/taslabs-net/homeflare-kit/pull/62) [`93b7107`](https://github.com/taslabs-net/homeflare-kit/commit/93b71070b1a64701cadc1a547044a3ec4da26a50) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export TB4 control-plane Resource constructors from `@homeflare/alchemy/proxmox` (Storage, SDN, access, HA, backup, metrics, PBS). Guests and NIC apply stay Provider-only.

## 0.4.0

### Minor Changes

- [#60](https://github.com/taslabs-net/homeflare-kit/pull/60) [`df34d27`](https://github.com/taslabs-net/homeflare-kit/commit/df34d2750fca4a2b6b86490ddb0a819c12f9ea39) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `BaoAuthMethod` so a stack can enable `approle` (or jwt/oidc) instead of running `configure-engines`. Metadata only — no role ids or OIDC secrets. File audit stays out: OpenBao 2.6 file audit is config-only.

## 0.3.2

### Patch Changes

- [#58](https://github.com/taslabs-net/homeflare-kit/pull/58) [`e7c101f`](https://github.com/taslabs-net/homeflare-kit/commit/e7c101faada2b14466a1f0bbf1f93da46e5e06cb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Bump Alchemy to 2.0.0-beta.79. Effect stays rc.115. 79 starts Bun with production JSX (the `jsxDEV` CLI crash on 78) and declares `mime` on cloudflare-runtime; the `mime` peer stays so existing consumer installs do not drop a required line.

## 0.3.1

### Patch Changes

- [#56](https://github.com/taslabs-net/homeflare-kit/pull/56) [`5f41ad7`](https://github.com/taslabs-net/homeflare-kit/commit/5f41ad7ab59375e42bb4757dd5b4b81f4a7b6cd9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoPkiRole` and `BaoSshRole` from `@homeflare/alchemy/openbao`. The barrel already shipped both providers; stacks constructing either role had to import the resource from internals.

## 0.3.0

### Minor Changes

- [#54](https://github.com/taslabs-net/homeflare-kit/pull/54) [`d526365`](https://github.com/taslabs-net/homeflare-kit/commit/d526365a51deac968e5b0076e88b2e68b866534f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Bump Alchemy to 2.0.0-beta.78 and Effect to 4.0.0-rc.115. Consumers must move the override set with it — Alchemy 78's peer is `effect >= rc.115`. Effect rc.115 renamed `Config.redacted` to `Config.Redacted`. `mime@4.1.0` is now a required peer: Alchemy's cloudflare-runtime imports it and does not declare it.

## 0.2.2

### Patch Changes

- [#46](https://github.com/taslabs-net/homeflare-kit/pull/46) [`9bc37f8`](https://github.com/taslabs-net/homeflare-kit/commit/9bc37f8bd7b9af1fd5c62cc4bc48597251ef61ab) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoMount` and `BaoAuthRole` from `@homeflare/alchemy/openbao`.

  The docs already showed `import { BaoMount } from '@homeflare/alchemy/openbao'`, but the barrel only shipped the providers. Stacks constructing those resources had to import from internals.

- [#48](https://github.com/taslabs-net/homeflare-kit/pull/48) [`4967118`](https://github.com/taslabs-net/homeflare-kit/commit/4967118cc887faba34b17cd48588102736be49bb) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `BaoCloudflareRole` and the Cloudflare role catalog helpers from `@homeflare/alchemy/openbao`, and retry dropped OpenBao transports.

  Stacks declaring mint roles need the resource constructor plus `parseRolesConfig` / `expandAll` / `permissionGroupsFromEngine`. The barrel previously shipped only `BaoCloudflareRoleProvider`. A 585-role plan against a Mesh-fronted vault died mid-diff with an empty transport error; status-0 calls now retry twice.

## 0.2.1

### Patch Changes

- [#40](https://github.com/taslabs-net/homeflare-kit/pull/40) [`60c90eb`](https://github.com/taslabs-net/homeflare-kit/commit/60c90eb4682d0ded2597a79033159ab71cc7a649) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Pin `rolldown` in the consumer overrides so an unlocked install cannot float a missing tarball.

  Alchemy's optional peer `vite@^8` depends on `rolldown: ~1.2.6`. A consumer `bun add`
  (no lockfile) resolved that to 1.2.9; npm listed the version and 404'd
  `rolldown-1.2.9.tgz`. Main CI failed on that fetch after [#39](https://github.com/taslabs-net/homeflare-kit/issues/39). The override holds 1.2.8 —
  the last tarball a green smoke actually installed.

## 0.2.0

### Minor Changes

- [#36](https://github.com/taslabs-net/homeflare-kit/pull/36) [`cff4111`](https://github.com/taslabs-net/homeflare-kit/commit/cff4111c2f4461a45be5811547125b1f5d98c6d2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Ship the HTTP and Website SDK surfaces apps were hand-rolling.

  **`@homeflare/kit/openapi`** — `createOpenApiApp()` is OpenAPIHono with one
  readable validation hook. The document and the request share a Zod schema.
  Subpath, not the main entry: a Node script that only wants `parseEnv` must not
  resolve Hono. Peers: `hono`, `@hono/zod-openapi`, `zod` (optional). Import `z`
  from `@hono/zod-openapi`.

  **`astroWebsite` / `viteWebsite`** on `@homeflare/alchemy/cloudflare` — house
  flags on Alchemy's own stacks. Astro gets `disable_nodejs_process_v2` (workerd
  process-v2 returns `[object Object]`). Vite is TanStack Start / static Vite.
  Not Nextjs: that helper hashes source and plans as create against a live Worker.

  Catalog also pins `@tanstack/react-router` 1.170.35, `@tanstack/react-start`
  1.168.52, `@tanstack/react-query` 5.102.8 — match these, do not wrap them.

## 0.1.3

### Patch Changes

- [#32](https://github.com/taslabs-net/homeflare-kit/pull/32) [`5cc2cd6`](https://github.com/taslabs-net/homeflare-kit/commit/5cc2cd62241f926aace1646fd3a1e0057e96cddd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `accessIdentity` (ctx.access) and RFC 9728 MCP discovery; fix three doc defects.

  An app team reviewed the published packages before adopting and was right on every point.

  **`accessIdentity(ctx)` — Access identity without parsing a JWT.** Cloudflare attaches the
  authenticated identity to the execution context (shipped 2026-08-14), so a Worker behind
  Access reads `ctx.access.getIdentity()` with no token handling. The kit only offered
  `verifyAccessJwt`, which is the older path.

  ⛔ Both stay, because they are not alternatives: `accessIdentity` for a Worker behind
  Access, `verifyAccessJwt` for an origin that has no `ctx.access` — service-to-service, a
  non-Worker origin, or a Worker reached by service binding, since **`ctx.access` does not
  propagate through bindings**.

  ⚠️ Read groups from `accessIdentity`, not from a token: Cloudflare trims the JWT's
  `custom` claim at roughly 1 KB _silently_, so token-read group membership can be
  incomplete — an authorization bug that only appears for users in many groups.

  **`serveMcpMetadata` / `unauthorizedResponse` — RFC 9728.** The MCP spec requires a server
  to publish Protected Resource Metadata _and_ a 401 naming it in `WWW-Authenticate`.
  Publishing the document while answering a bare 401 leaves clients that follow the header
  with nowhere to go.

  **Three documentation defects, all reported and all real:**

  - `@homeflare/alchemy`'s README documented `@homeflare/alchemy/providers`, which does not
    exist. The real path is `/cloudflare`.
  - `@homeflare/cloudflare`'s npm description advertised "typed bindings" — it exports none.
  - `@homeflare/kit`'s advertised "logging" — `log` lives in `@homeflare/cloudflare`.

  **Packing no longer edits a manifest on disk.** `packForPublish` stripped `scripts` and
  `devDependencies` from the real `package.json`, packed, then restored it — which is a race
  when two smoke tests pack the same workspace dependency in parallel. It destroyed
  `@homeflare/kit`'s `scripts` block during this branch, _after_ `verify` had passed. The
  strip now happens inside the packed tarball, so nothing in the repository is written to.

## 0.1.2

### Patch Changes

- [#29](https://github.com/taslabs-net/homeflare-kit/pull/29) [`72f0787`](https://github.com/taslabs-net/homeflare-kit/commit/72f0787952b3a71bb6573476918e79117250409e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `cloudflare` is a required peer, not an optional one.

  Measured 2026-09-16 against the published 0.1.1 in a clean consumer install: importing
  `@homeflare/alchemy/cloudflare` without it throws `Cannot find package 'cloudflare'`.
  Marking it optional claimed the subpath would degrade gracefully; it does not load at all.
  An optional peer should mean a _feature_ is absent, not that an import fails.

  ⛔ **Why this got through, and what now stops it.** The README's pinned install command and
  the smoke test's install command disagreed — the smoke test installed `cloudflare`, the
  README never mentioned it, and nothing compared the two. So the gate proved an install no
  consumer would ever perform.

  `tests/peers.test.ts` now asserts the manifest, the README and the smoke script agree:
  every declared peer appears in all three, peers are pinned rather than ranged, and none is
  marked optional.

## 0.1.1

### Patch Changes

- [#27](https://github.com/taslabs-net/homeflare-kit/pull/27) [`5b73400`](https://github.com/taslabs-net/homeflare-kit/commit/5b73400e7fc2dd8e28a0368db3e5aa105ebdde9a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix the peer contract: 0.1.0 installed cleanly and threw at import.

  Measured 2026-09-16 against the published 0.1.0 in a clean consumer install — three
  defects, none of which failed at install time:

  1. **`@effect/platform-node` was a devDependency**, so a consumer got
     `Cannot find module '@effect/platform-node/NodeServices'`. Alchemy's module graph
     reaches `Cloudflare/Workers/WorkerBridge` even when you only import `/proxmox`, so it
     is a required peer, not an optional one.
  2. **The `effect` peer was ranged** `>=4.0.0-rc.112`, which resolves to rc.115 —
     `TypeError: Config.string is not a function`. Effect's rc line is not
     semver-compatible with itself, so a range is a promise this package cannot keep. Peers
     are pinned exactly now.
  3. **`@effect/platform-node-shared` still resolves up** to rc.115 against effect rc.112
     (`Cannot find module 'effect/ByteSize'`), because `platform-bun@rc.112` asks for
     `^4.0.0-rc.112`. Only a consumer-side `overrides` block holds the set together, and the
     README now says so with the exact block to paste.

  ⛔ The smoke script was `echo '…exercised by the consuming stack'` — a check that cannot
  fail, which is how all three shipped. It now packs the tarball, installs it the way the
  README says, and **imports every subpath**, because each of these threw at import rather
  than at install.

## 0.1.0

### Minor Changes

- [#25](https://github.com/taslabs-net/homeflare-kit/pull/25) [`309c644`](https://github.com/taslabs-net/homeflare-kit/commit/309c644d83c7149571f4caada135d1b8d141a484) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New package: custom Alchemy providers for five systems the vendor has none for.

  **`R2BucketLock`** — an R2 bucket's lock rules, declared rather than applied by hand. A
  lock rule is a retention floor: while a rule covers an object, no API call, no lifecycle
  rule and no credential can delete it.

  ★ Alchemy 2.0.0-beta.77 has no lock property anywhere in its R2 namespace, so the
  alternative was a runbook step a human runs once — and a plan can never show a missing
  runbook step. Covering the gap with a resource makes the drift visible in `plan`.

  ⛔ Deletion is refused by design: removing a lock removes a retention floor, which is the
  one operation this resource exists to make hard.

  ⚠️ `alchemy`, `cloudflare` and `effect` are **peers**, not dependencies — Alchemy's
  resource registry and Effect's context both break if two copies load in one process.

  **Also in this release** — the same treatment for four more systems, 140 files in all:

  - **`/proxmox`** (61 source files) — ACLs, API tokens, backup jobs, Ceph, SDN, storage.
  - **`/openbao`** (33) — mounts, policies, PKI/SSH/auth roles, Cloudflare role expansion.
  - **`/forgejo`** (12) — branch protection, org secrets, labels, webhooks.
  - **`/talos`** (8) — cluster bootstrap, machine config, health.

  ⛔ **Import a subpath, never the root.** Each system carries its own client, so a root
  barrel would pull Proxmox into a stack that only wanted Forgejo.

  ★ **The barrels are deliberately smaller than the directories** — 70 exported symbols out
  of 606 defined, chosen from what a real stack actually consumes. An `export *` would
  publish every helper as API and make the next refactor a breaking change.
