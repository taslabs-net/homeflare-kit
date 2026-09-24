# @homeflare/alchemy

Earlier releases: [changelog archive](./docs/changelog/README.md).

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
