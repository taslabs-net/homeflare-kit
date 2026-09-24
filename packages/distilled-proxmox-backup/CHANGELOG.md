# @homeflare/distilled-proxmox-backup

## 0.2.0

### Minor Changes

- [#200](https://github.com/taslabs-net/homeflare-kit/pull/200) [`f6f1677`](https://github.com/taslabs-net/homeflare-kit/commit/f6f167742122d1e5d90270246882877b9f468c2a) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-proxmox-backup`, an unmodified copy of the (not
  yet upstream-published) `@distilled.cloud/proxmox-backup` SDK — 367
  operations across 13 Proxmox Backup Server API areas (access, admin,
  backup, config, nodes, ping, pull, push, reader, root, status, tape,
  version; 0 skipped), generated from PBS's own `apidoc.js` (no OpenAPI
  document exists; reuses the Smithy converter built for
  `@homeflare/distilled-proxmox`, adapted for PBS's dialect — see
  `packages/proxmox-backup/scripts/apidoc.ts`'s header in the distilled
  clone for the two confirmed differences: `var` vs `const` declaration,
  `];` vs `]` terminator), pinned to the vendor schema at
  `proxmox-backup-server` 4.2.6-1 (sha256 `274ab9f6…`, the house schema
  manifest's `pbs-apidoc` entry).

  Ships `catchTag`-able typed errors — the shared HTTP status classes and
  PBS's global `ParameterVerificationFailed`/`BadRequest` split (same
  retry-safety reasoning as the PVE package: a bare 400 must not retry as a
  server error) — plus `awaitTask` (`./Task`), which polls a queued action's
  task status until PBS's own `exitstatus` is exactly `"OK"`, confirmed
  against the pinned schema (`GET /nodes/{node}/tasks/{upid}/status` exists,
  UPID-pattern parameters appear 44 times).

  **Does NOT carry PVE's `ClusterNodeUnreachable` (595) trap** — the pinned
  PBS schema has zero `proxyto` occurrences; PBS is not a cluster product.

  ⚠️ The auth header differs from PVE: `PBSAPIToken=<id>:<secret>` (colon,
  not `=`) — confirmed against this estate's own
  `packages/alchemy/src/proxmox/credentials.ts` and `pbs-prune-job.ts`, both
  themselves reasoned from PBS's documented scheme rather than a live call
  (the estate has no PBS host or credential yet). No live PBS call was made
  building this package either; the smoke test proves the request this SDK
  BUILDS is correct, not that a real PBS host accepts it.

  Fourth package on the kit's interim-package route established by
  `@homeflare/distilled-netbox` — same layout, license (Apache-2.0, a
  redistribution of `alchemy-run/distilled`'s own output), pins and smoke
  test; see `packages/alchemy/docs/distilled-interim.md`. This PR does not
  alias `@distilled.cloud/proxmox-backup` onto anything and does not touch
  any existing `packages/alchemy/src/proxmox/*` PBS resources — the alias
  can only resolve once this package is actually on npm; that migration is a
  follow-up PR, same as the PVE package's own history.
