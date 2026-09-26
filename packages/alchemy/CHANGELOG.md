# @homeflare/alchemy

Earlier releases: [changelog archive](./docs/changelog/README.md).

## 0.39.0

### Minor Changes

- [#302](https://github.com/taslabs-net/homeflare-kit/pull/302) [`3f8a8af`](https://github.com/taslabs-net/homeflare-kit/commit/3f8a8af9df4dcdb0dd54be0f50f15d62e815b434) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/telemetry`: `telemetryLayer`, an OTLP tracing/logging/metrics `Layer` a
  stack merges into its own `providers` — off unless given explicit `{ traces?, logs?, metrics? }`
  endpoints, no default collector anywhere in it. This is not alchemy's own CLI-wide telemetry
  (`otel.alchemy.run`, hard-coded, opted out via `~/.alchemy/telemetry-disabled`): it is a per-stack
  layer a consumer opts into with its own endpoints (the estate's Victoria stack, in homeflare-mini's
  case — this package names no estate host).

  Every span — a provider's own, effect's `HttpClient` client spans, and alchemy's own plan/apply
  engine spans — is redacted before export in two passes: `Tracer.Tracer` itself drops every HTTP
  header outright, strips every query string and blanks a consumer-supplied denylist of host/path
  segments (e.g. a UniFi console id) to `<redacted>`; a second pass at `OtlpSerialization` catches what
  that first pass cannot reach — a failed span's `exception.message`/`status.message` (built from the
  exit's `Cause` at export time) and a log line turned into a span event — by matching the denylist as
  a substring in that free text, and covers logs the same way. Bodies are protobuf-encoded, not
  JSON — VictoriaLogs/Metrics both reject the OTLP JSON encoding, silently, so the wire format is not
  a style choice. The transport is sealed — merging this layer into a stack's `providers` alongside a
  fetch-based provider (Caddy, LiteLLM, Forgejo) never lets its own `FetchHttpClient` leak into that
  provider's requirements, the same leak PR 293 fixed for Caddy's admin transport.

  See [docs/telemetry.md](../packages/alchemy/docs/telemetry.md) for how a consumer stack wires real
  endpoints in, and [docs/telemetry-spike.md](../packages/alchemy/docs/telemetry-spike.md) for what an
  offline spike against alchemy 2.0.0-beta.79's own engine measured actually arriving at a collector.

- [#296](https://github.com/taslabs-net/homeflare-kit/pull/296) [`4bdcc4f`](https://github.com/taslabs-net/homeflare-kit/commit/4bdcc4fc2340bea9696156b7b4ff4ef19eadfeff) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Forgejo.TeamMember` now declares `defaultRemovalPolicy: 'retain'`, matching `Forgejo.Repository`
  and `Forgejo.OrgLabel`. Previously the family had no default, so alchemy's own engine fallback
  (`destroy`) applied: dropping a `TeamMember` declaration from a stack — a feature gate toggled off,
  a resource id renamed — called `organization.orgRemoveTeamMember` and revoked a real membership on
  live Forgejo, with no way to tell from the declaration alone that this would happen. Found in
  `homeflare-mini` PR 82's red team (970e8be), which had to pipe every `ForgejoTeamMember(...)` call
  through `.pipe(RemovalPolicy.retain())` by hand to avoid dropping `forgejo-provision` from `Owners`.

  A stack that means to remove a real membership still can, with `.pipe(RemovalPolicy.destroy())` —
  `destroy` was, and stays, fully implemented. A stack already piping `RemovalPolicy.retain()` by hand
  (homeflare-mini) is unaffected; the pipe is now redundant, not wrong. Bumped as `minor`, not `patch`:
  this changes what removing a declaration does, not just an internal detail.

  ⚠️ **The new default does not protect an existing row until you deploy once first.** Alchemy plans
  a removal from the policy saved on that resource's state row, not from this default — the default
  only reaches an already-existing row's state on a deploy where the resource is otherwise a no-op
  (alchemy rewrites the row and logs `removal policy destroy → retain`). Concretely:

  - **To adopt retain for a `TeamMember` declared before this bump:** deploy the version bump first,
    with the declaration left in place (a no-op plan updates the saved policy). Only remove the
    declaration in a later deploy.
  - **Dropping the bump and the declaration in the SAME deploy still deletes the live membership** —
    the plan reads the row's old `destroy` policy, not this new default.
  - **To revoke a membership on purpose**, the sequence is unchanged: deploy with
    `.pipe(RemovalPolicy.destroy())` first, then remove the declaration in a later deploy.

- [#297](https://github.com/taslabs-net/homeflare-kit/pull/297) [`a821575`](https://github.com/taslabs-net/homeflare-kit/commit/a82157562aeea6fe06a2dd9382e131451411691e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `Proxmox.Vm` (`ProxmoxVm`) from the public barrel for Talos VMs: cpu/cores/sockets/memory,
  scsi disks on any storage (including `cephtb4`), `net0`/indexed NICs as a VLAN-aware bridge+tag,
  the cloud-init drive and `ipconfig0`, boot order, the guest agent and a serial console. Every field
  is managed only when declared (`qemu-props.ts`'s declared-keys model) — the fix for the
  "5-default PUT", where an update used to resend `cores`/`memory`/`name`/`onboot`/`sockets` with a
  hard default for whichever field the declaration left out, silently resetting it on an adopted VM.
  `cipassword` and `machine` can never be props (typed `never`, and refused at runtime if smuggled
  past the types). `ProxmoxVm` defaults to `RemovalPolicy.retain()`. Node-pinned semantics are
  unchanged: a VM found on another node still fails the plan ("A migration is not an update").

  Add `Proxmox.StorageDownload` (`ProxmoxStorageDownload`): a checksum-pinned `download-url` fetch
  onto a storage's `import` content, for staging a Talos boot image before a `Proxmox.Vm` references
  it as a disk source. `checksum`/`checksumAlgorithm` are required props (narrower than the vendor's
  own optional pair) and refused at runtime if left blank. There is no update path — PVE does not
  remember the `url`/`checksum` a volume was created from, so `filename` (with `storage`) is the
  identity: changing it plans a `replace` (the old file is deleted, the new one downloaded under its
  own name); a changed `checksum`/`url`/etc on the SAME `filename` is refused at plan time rather than
  silently accepted, since there is nothing left to verify it against. A failed download task (a
  checksum mismatch included) refuses the plan rather than reporting success. Delete is idempotent
  (a volume already gone is success) and not retained by default, since the file is reproducible from
  its own declaration.

  Both families are wired into the vendor constraint tables (`download-url`'s own
  `generated/constraints/pve-nodes-storage.ts`) and the ownership ledger, so a value the vendor would
  reject is refused at plan time. A live VM or file this stack holds no state for is never adopted or
  written without `--adopt` / `adopt(true)` (`ownership/probe.ts`'s `ownedRead`, `ownership/adopt.ts`'s
  `refuseTakeover`) — for `Proxmox.StorageDownload` this also guards its delete, since the family is
  not retained by default. A changed `vmid` on an already-managed `Proxmox.Vm` is refused as a
  different machine rather than planned as an update. Disk (`scsiN`/`ideN`) and NIC (`netN`) drift is
  now judged per key against the live volume id and live MAC (`qemu-volume.ts`/`qemu-net.ts`), so a
  declared "new disk" or MAC-less NIC no longer re-drifts (and gets rewritten) on every deploy after
  PVE allocates the real volume or generates the real MAC. Fixed a codegen gap surfaced by
  `download-url`'s `compression` parameter: an explicit vendor `"enum": null` (as opposed to an absent
  `enum`) was copied verbatim into the emitted table instead of being treated as no constraint.

### Patch Changes

- [#301](https://github.com/taslabs-net/homeflare-kit/pull/301) [`413f62b`](https://github.com/taslabs-net/homeflare-kit/commit/413f62b01ddb7e3fafb1f39f4b0153aa9ddadf5b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Unifi.*` providers now refuse any non-`GET` request at the wire (`GetOnlyHttpClient`, installed in `unifiHandlers`), defense in depth alongside the existing per-operation write refusal, backed by a static test that bans any create/update/delete/patch/execute/remove/adopt SDK reference under `src/unifi`. Added `src/unifi/paginate.ts`'s consumer-side offset pager for the SDK's un-paginated list operations, and a pure `driftOf(live, props)` per family (`Unifi.Network`, `Unifi.FirewallZone`) reporting field-level drift for a future pre-import check.

## 0.38.0

### Minor Changes

- [#293](https://github.com/taslabs-net/homeflare-kit/pull/293) [`f11e6a6`](https://github.com/taslabs-net/homeflare-kit/commit/f11e6a6cae2ee4ca0a4604f4f23ecf1924351958) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `caddyProviders()` no longer merges Caddy's admin `HttpClient.HttpClient` (and `Credentials`) into
  the stack's own ambient context. Previously `caddyAdminLayer` `provideMerge`d Caddy's admin transport
  straight into `caddyProviders()`'s own Layer output; any other fetch-based provider merged into the
  same stack — `Layer.mergeAll(…, caddyProviders(), …, forgejoProviders())`, for example — could then
  resolve Caddy's admin `HttpClient.HttpClient` instead of the stack's real ambient one for its own
  `read`/`diff`/`reconcile` calls, misrouting its requests to Caddy's admin API. Affected: any stack
  that loads `caddyProviders()` alongside another fetch-based provider (homeflare-mini's `Forgejo.*`
  and `LiteLLM.PassThroughEndpoint` rows measured reading against Caddy's admin API instead of their
  own targets — verify's `read` came back absent/failed; writes were not exercised, so they are
  inferred from the same misrouted client, not separately measured).

  The admin transport's `Credentials`/`HttpClient.HttpClient` are now carried under a new house-only
  `CaddyAdminTransport` tag (never a generic platform service), and `CaddyConfigProvider()` provides
  them locally, scoped to exactly the effects that call `@distilled.cloud/caddy`'s operations. Caddy's
  own behaviour (unix socket and TCP admin, retries, timeouts, the admin guard) is unchanged.

  Public API narrowed: `caddyAdminLayer` now returns `Layer<CaddyAdminService | CaddyAdminTransport>`
  (previously it also carried `Credentials | HttpClient.HttpClient`), and `CaddyConfigProvider()` now
  requires `CaddyAdminTransport` instead of those SDK services directly. `caddyProviders()` and
  `localCaddyAdmin()` are unaffected; only code that wired `caddyAdminLayer`'s output by hand, or ran
  `@distilled.cloud/caddy` operations directly against it outside `caddyProviders()`, would need to
  change — no tray repo does this today. Bumped minor rather than patch because the package is 0.x and
  this narrows a public contract.

## 0.37.8

### Patch Changes

- [#290](https://github.com/taslabs-net/homeflare-kit/pull/290) [`6ddbff3`](https://github.com/taslabs-net/homeflare-kit/commit/6ddbff38096feecb36d3f0efe6efc0418e938145) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Podman.Container` no longer reads as an existing (and therefore "adopted") resource when its
  `.container` file is absent but a PLAIN unit that genuinely outranks Quadlet's generator in
  systemd's unit load path — `/etc/systemd/system` chief among them, never a vendor directory like
  `/usr/lib/systemd/system`, which is lower precedence than the generator and not a real shadow —
  already answers to the same service name. The read now refuses at plan time, naming the shadowing
  unit file and the fix (move it aside before declaring the container), instead of a create silently
  becoming an "adopted" plan whose eventual apply would leave the pre-existing plain unit running
  untouched while state recorded attributes read back from it. `verifyGenerated` is also hardened to
  check the same fact as a backstop at apply time, for the case this plan-time check does not cover.

- [#292](https://github.com/taslabs-net/homeflare-kit/pull/292) [`4225c4c`](https://github.com/taslabs-net/homeflare-kit/commit/4225c4c95dbf3e7e763c83565481487ef1a88212) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `sshSudoRunner` now lets `Podman.Container` reach its own Quadlet-generated unit: a generated
  unit's `FragmentPath` sits under a systemd generator's own output directory (`/run/systemd/generator`,
  never a declared prefix), but its `SourcePath` names the `.container` file that produced it — when
  that `SourcePath` is under a declared prefix, the runner elevates. Previously every generated unit
  was refused outright, so `Podman.Container` could never be restarted through this runner at all.

  `Systemd.Unit`'s validation now accepts leading blank lines and `#`/`;` comments before the first
  `[Section]`, per `systemd.syntax(7)` — a unit file systemd already loads could still fail
  `assertValid` if its first lines were comments. A genuine `key=value` line with no section still
  refuses.

  `Podman.Container`'s "the container's unit is NOT running" refusal message no longer asserts a
  running state it does not actually know (measured false for a refusal that ran before sudo did
  anything at all); it reads the unit's live state back and reports that instead.

## 0.37.7

### Patch Changes

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move Lxc reads, writes and task polling to named distilled operations. Preserve task
  credentials, ownership, digests, no-shrink checks and retention; prove absence with
  the exact SDK missing-config tag and the same credential's cluster-wide vmid check.

- [#283](https://github.com/taslabs-net/homeflare-kit/pull/283) [`a19c663`](https://github.com/taslabs-net/homeflare-kit/commit/a19c6632e3654c73fb3bf03dd9e2869b9ed65fdd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Keep the PVE network `changes` sibling through the distilled protocol, and move NetworkApply onto named operations without storing the diff.

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move ReplicationJob and FirewallAlias lifecycle transport to named distilled SDK operations. Preserve no-write adoption, existing form and deletion semantics, and fail closed on unrelated errors or malformed reads.

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix two regressions from the distilled transport migration: ReplicationJob reads no
  longer fail closed when a SectionConfig release echoes guest/jobnum as text instead
  of a JSON number, and lxcTask's poll loop no longer aborts a still-running task on a
  status word other than exactly "running"/"stopped".

- [#282](https://github.com/taslabs-net/homeflare-kit/pull/282) [`08b1789`](https://github.com/taslabs-net/homeflare-kit/commit/08b1789cf835af177960aba5e4fbf16d007b087e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move Proxmox.Vm onto named QEMU operations. Guest deletion uses the destroy route, and only the vendor missing-config error is absence.

- [#282](https://github.com/taslabs-net/homeflare-kit/pull/282) [`08b1789`](https://github.com/taslabs-net/homeflare-kit/commit/08b1789cf835af177960aba5e4fbf16d007b087e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix a regression in the QEMU distilled transport migration: qemuTask's poll loop no
  longer aborts a still-running VM create/destroy on a status word other than exactly
  "running"/"stopped" (the same class of fix already shipped for lxcTask).

## 0.37.6

### Patch Changes

- [#276](https://github.com/taslabs-net/homeflare-kit/pull/276) [`0d9175d`](https://github.com/taslabs-net/homeflare-kit/commit/0d9175d89f5b05eea64da731affb4a5edc9b4e25) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Use the distilled OpenBao SDK for AppRole metadata reads, writes, deletes and rename
  collision checks. Preserve omitted role settings and existing no-op, ownership and deletion
  guards; permission and malformed-response failures never become absence. Reads and the
  metadata write retain the existing bounded transport retry — the write sends every managed
  field every time, so replaying it after a transport failure converges on the same role;
  delete makes one attempt. Checked against the OpenBao 2.6.2 generated AppRole schema and
  pinned vendor source. No login or credential issuance operations change.

- [#276](https://github.com/taslabs-net/homeflare-kit/pull/276) [`0d9175d`](https://github.com/taslabs-net/homeflare-kit/commit/0d9175d89f5b05eea64da731affb4a5edc9b4e25) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Run every OpenBao ACL policy lifecycle call, including rename collision reads, through
  the distilled OpenBao SDK. Preserve shared concurrency limits, agent sockets, runtime
  credentials, namespace selection, and token trace redaction. Only typed missing-policy
  errors mean absence; refused and malformed reads fail. Reads retain bounded transport
  retries; a policy write sends the full policy text every time, so it retries a transport
  failure the same bounded way; a delete makes one attempt after an uncertain response.
  Checked against the OpenBao 2.6.2 generated schema and pinned vendor policy handlers.

## 0.37.5

### Patch Changes

- [#285](https://github.com/taslabs-net/homeflare-kit/pull/285) [`e62f8e9`](https://github.com/taslabs-net/homeflare-kit/commit/e62f8e975b3c9a110a7e94c9c02644539e459600) Thanks [@taslabs-net](https://github.com/taslabs-net)! - LiteLLM pass-through calls use the fetch HTTP client, so a stack that also provides Caddy's admin client still reaches the proxy. Host.Directory recovers an interrupted create whose path was still an Output instead of crashing the next plan.

## 0.37.4

### Patch Changes

- [#280](https://github.com/taslabs-net/homeflare-kit/pull/280) [`2c8556e`](https://github.com/taslabs-net/homeflare-kit/commit/2c8556e7625d2596f41f238f2018c65df555bbc9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Host.Directory on macOS no longer passes `--` to chmod and chown. Those BSD tools treat that token as a filename, so a first deploy created the directory and then failed the resource. Linux still passes `--`, which the sudo allowlist requires. mkdir and rmdir are unchanged.

  The archive inflater's source stream is typed as the chunk type DecompressionStream accepts, so the package typechecks under TypeScript 7. The bytes are unchanged.

- [#281](https://github.com/taslabs-net/homeflare-kit/pull/281) [`b0c9fc9`](https://github.com/taslabs-net/homeflare-kit/commit/b0c9fc9580463cff30c94efebe498b8cef7c9ddd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `LiteLLM.PassThroughEndpoint` can be yielded from an Alchemy stack body. The proxy credentials stay on the provider layer, and that layer keeps them available when the engine calls the handlers.

## 0.37.3

### Patch Changes

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Run PBS notification matchers and sendmail, SMTP and webhook targets through the distilled
  Proxmox Backup Server SDK. Read failures now preserve their typed errors instead of planning
  false creates; only typed NotFound means absence or an already completed delete. Keep leased
  credentials, bounded requests, secret seals and no-op adoption. Vendor schema: PBS 4.2.6-1,
  SDK 0.3.1.

  Preflight replacement destinations, required write-only values and vendor/SDK input constraints
  before deleting a working target. Typed destination read failures stop replacement; existing
  renamed targets remain adoptable without requiring secret values the plan cannot observe.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Run PBS datastore, prune, sync and verification providers through the distilled PBS SDK,
  using the proxmox-backup-server 4.2.6-1 schema. Preserve existing retention, parked-job,
  create-only and state semantics while allowing only typed missing-section errors to mean
  absence. Permission, transport and malformed-response failures now stop planning instead
  of suggesting a create or confirming a deletion.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Use direct distilled SDK operations for PVE Pool, BackupJob and MetricServer lifecycle calls,
  walked against pve-manager 9.2.11. Only typed missing-object errors permit creation or idempotent
  deletion; authentication, permission and unrelated server failures propagate. Preserve existing
  adoption no-ops, retention normalization, omitted backup settings and metric-server secret fields.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Move PVE notification targets and matchers onto generated distilled SDK operations.
  Failed reads now stop the plan; only typed NotFound means absence. Keep matching
  adoption write-free, preserve list items and explicit clearing, and validate read
  payloads without exposing server values. Identity changes replace the old resource;
  a same-name endpoint type change deletes first because names are shared across types.
  Preflight the destination and its vendor/SDK input constraints before replacement can
  delete a working target. Typed destination read failures stop replacement, while existing
  renamed targets remain adoptable without create-only secrets.

  Vendor schema: pve-manager 9.2.11. Read-only probes confirmed missing notification
  GETs return 404; write behavior is exercised through the real SDK and Alchemy engine
  against isolated fixtures, with no live notification changes.

## 0.37.2

### Patch Changes

- [#270](https://github.com/taslabs-net/homeflare-kit/pull/270) [`7710691`](https://github.com/taslabs-net/homeflare-kit/commit/77106917f0781d53bfedde224f71e7a7ad9b62bc) - Complete the CephFS transport migration to distilled Proxmox 0.3.0 (vendor schema
  pve-manager 9.2.11): send destructive DELETE flags through its corrected query binding
  and fold only the typed CephFsNotFound error. Preserve bounded task polling, safe
  omitted-flag defaults and the final live index read that proves deletion.

## 0.37.1

### Patch Changes

- [#268](https://github.com/taslabs-net/homeflare-kit/pull/268) [`7c9e674`](https://github.com/taslabs-net/homeflare-kit/commit/7c9e674545829191a560730924e557d5ccbb2bd2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Use the distilled Proxmox SDK's typed missing-user, group, storage and Ceph-pool errors
  for absence. Propagate other cold-read/reconcile failures, and propagate failed Ceph
  filesystem and daemon index reads instead of treating them as missing resources.

  This prevents speculative creates after failed reads and prevents a CephFS delete
  from claiming success when its preflight or read-back cannot observe the filesystem.
  Existing confirmed-row User/Group/Storage checks and credential-denial reporting remain.
  Real-protocol fixtures cover expected absence and unrelated 401/403/500 errors; engine
  tests prove a failed cold read sends no create and a failed delete read is not success.
