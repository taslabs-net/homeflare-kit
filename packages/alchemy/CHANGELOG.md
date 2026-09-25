# @homeflare/alchemy

Earlier releases: [changelog archive](./docs/changelog/README.md).

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
