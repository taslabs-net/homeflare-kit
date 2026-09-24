# @homeflare/distilled-proxmox-backup

## 0.3.1

### Patch Changes

- [#272](https://github.com/taslabs-net/homeflare-kit/pull/272) [`839aa8d`](https://github.com/taslabs-net/homeflare-kit/commit/839aa8d7e5a9176e3b26eb3f083cb23d7df3a1e1) - Encode PVE and PBS form arrays as repeated keys and expose precisely typed
  missing configuration errors so Alchemy providers can adopt and delete safely.
  Validate PBS responses while preserving extra fields and valid Unit responses;
  malformed payload diagnostics do not retain server data.
  Both SDK error unions now include every HTTP status class their protocols return,
  so callers can handle typed NotFound without hiding other failures.

  Regenerated from local distilled source against pve-manager 9.2.11 and
  proxmox-backup-server 4.2.6-1 schemas. Read-only probes on PVE 9.2.11 and PBS
  4.2.3 confirmed missing-resource wire shapes; the PBS SDK also read live version,
  datastore and notification configuration successfully. No upstream write.

## 0.3.0

### Minor Changes

- [#265](https://github.com/taslabs-net/homeflare-kit/pull/265) [`d50bfe6`](https://github.com/taslabs-net/homeflare-kit/commit/d50bfe6d52f92596da99658c34a4ad97cf5f9c23) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Upstream-walk-down fixes to the PBS distilled SDK, built the distilled way in
  `homeflare/proxmox-backup` (worktree commit `6fc1d295`) and copied in unmodified — never
  hand-edited here.

  **WI-1 (DELETE query binding, wire behavior change).** Same bug and fix as
  `@homeflare/distilled-proxmox`'s own release note (this converter is a direct port): the
  converter bound every DELETE operation's non-label parameters to the request body — core's own
  convention is query, not body, for DELETE (Kubernetes' generated DELETE operations are the
  upstream precedent). Recounted by parsing the generated Smithy operation shapes directly (not
  the plan's original "19 of 20" estimate, which this pass found to be wrong): 24 of 38 PBS DELETE
  request schemas carry at least one non-label parameter, and every one of those 24 carried a body
  member. No kit code
  currently imports `@distilled.cloud/proxmox-backup` (measured — it is aliased in
  `packages/alchemy/package.json` but unused), so this is wire-neutral for what ships today.

  **WI-2 (spec provenance — no functional change, declared honestly).** This package consumed
  `specs/.local` with no `SPEC_REPOS` entry, so `specs:check` failed and nobody else could
  regenerate it — the committed output existed only via a gitignored local copy. Proxmox publishes
  no `pbs-docs` mirror the way it does `pve-docs` (`https://api.github.com/repos/proxmox/pbs-docs`
  answers 404), and the estate has no PBS host yet to pull the real spec from over SSH. Declared
  `blocked` in `SPEC_REPOS` (the Slack precedent) rather than given a non-functional fetch-script
  scaffold. `specs:check` now passes. Regenerating from `specs/.local` reproduces `src/services/*`
  byte-for-byte across two independent runs (verified via sha256).

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
