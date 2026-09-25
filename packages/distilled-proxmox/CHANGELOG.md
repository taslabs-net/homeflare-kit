# @homeflare/distilled-proxmox

## 0.3.3

### Patch Changes

- [#283](https://github.com/taslabs-net/homeflare-kit/pull/283) [`a19c663`](https://github.com/taslabs-net/homeflare-kit/commit/a19c6632e3654c73fb3bf03dd9e2869b9ed65fdd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Keep the PVE network `changes` sibling through the distilled protocol, and move NetworkApply onto named operations without storing the diff.

- [#282](https://github.com/taslabs-net/homeflare-kit/pull/282) [`08b1789`](https://github.com/taslabs-net/homeflare-kit/commit/08b1789cf835af177960aba5e4fbf16d007b087e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move Proxmox.Vm onto named QEMU operations. Guest deletion uses the destroy route, and only the vendor missing-config error is absence.

## 0.3.2

### Patch Changes

- [#277](https://github.com/taslabs-net/homeflare-kit/pull/277) [`855f3fb`](https://github.com/taslabs-net/homeflare-kit/commit/855f3fbf6fd10ddced3debe03ac7038715207809) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Expose the vendor's exact missing-container-config response as LxcConfigNotFound on
  GET, PUT and DELETE (all three raise byte-identical vendor text). Keep generic server
  failures and other guest paths distinct.

- [#277](https://github.com/taslabs-net/homeflare-kit/pull/277) [`855f3fb`](https://github.com/taslabs-net/homeflare-kit/commit/855f3fbf6fd10ddced3debe03ac7038715207809) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Expose the vendor's exact missing-network-interface response as NetworkInterfaceNotFound
  on GET and PUT (both raise byte-identical vendor text). Keep unrelated or multi-field
  parameter validation failures distinct.

- [#277](https://github.com/taslabs-net/homeflare-kit/pull/277) [`855f3fb`](https://github.com/taslabs-net/homeflare-kit/commit/855f3fbf6fd10ddced3debe03ac7038715207809) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Classify source-backed replication-job and firewall-alias absence with precise typed errors, retaining unrelated validation and server failures.

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

- [#265](https://github.com/taslabs-net/homeflare-kit/pull/265) [`d50bfe6`](https://github.com/taslabs-net/homeflare-kit/commit/d50bfe6d52f92596da99658c34a4ad97cf5f9c23) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Upstream-walk-down fixes to the PVE distilled SDK, built the distilled way in
  `homeflare/proxmox` (worktree commits `ef0e4888`, `19c1b641`) and copied in unmodified — never
  hand-edited here.

  **WI-1 (DELETE query binding, wire behavior change).** The converter bound every DELETE
  operation's non-label parameters to the request body, which PVE's server never reads for DELETE
  (measured: `AnyEvent.pm` parses request content into params only for PUT/POST). Recounted by
  parsing the generated Smithy operation shapes directly (not a regex over source, and not the
  plan's original "40 of 51" estimate, which this pass found to be wrong): 44 of 79 PVE DELETE
  request schemas carry at least one non-label parameter, and every one of those 44 carried a body
  member that PVE silently discarded before this fix. DELETE now binds like
  GET — query string. Every kit call site under `packages/alchemy/src/proxmox/*` that calls a
  delete operation today passes labels only, so this is wire-neutral for what ships — except
  `ceph-osd-write.ts`'s `deleteNodeCephOsd`, whose `cleanup` flag was already riding a DELETE body on
  both `client.ts` and distilled alike (that file's own header calls this out as a pre-existing,
  out-of-scope bug "worth its own fix — move `cleanup` into the query string"). This SDK change is
  exactly that fix: `cleanup=1` goes from silently-ignored to an effective query parameter. No kit
  consumer code changes in this PR (that stays scoped to WI-4/its own follow-up); the wire-change
  audit lives in this PR's description.

  **WI-3 (typed not-found errors, new exports).** Adds `UserNotFound`, `GroupNotFound`,
  `StorageNotFound`, `CephPoolNotFound` (`access`/`storage`/`nodes` services) and `CephFsNotFound`
  (`nodes`), each a `client`/404-tagged shape matching PVE's real HTTP-500 wire response by an
  anchored, object-kind-qualified message regex — never a bare "does not exist" — following the
  Forgejo `orgDelete.json` pattern. Each is attached only to the single operation actually measured
  producing it. Runtime-verified non-transient via `Category.isTransientError`, and each decodes
  correctly from its measured wire fixture.

  **Every message traced to actual PVE Perl source, not just the kit's own prose.** An adversarial
  review caught that `CephFsNotFound`'s regex and test fixture were both written from the same two
  unmeasured kit comments — self-confirming, not independently measured. Fixed by cloning
  `pve-access-control`, `pve-storage` and `pve-manager` read-only, at commits at or near this SDK's
  own pin (`pve-manager`'s `f6997e698c7933ea`, "bump version to 9.2.11", is the exact commit the
  kit's own `fetch-specs.ts` already cites as what the estate runs), and reading the actual `die`
  line for each message: `UserNotFound` (`AccessControl.pm:678`), `GroupNotFound` (`Group.pm:201`),
  `StorageNotFound` (`Storage.pm:259`), `CephFsNotFound` (`Ceph/FS.pm:327`) — plus confirming each
  is reachable from the exact GET/DELETE handler this SDK's operation maps to (matched by the
  handler's own `description` string). `CephFsNotFound`'s assumed text was wrong: the real message
  is `no such cephfs '$fs_name'\n` (the filesystem name is included), not the bare `no such cephfs`
  the first draft assumed — the regex and test fixture are corrected. `CephPoolNotFound`'s message
  comes from Ceph/librados itself, not PVE's own Perl, so only the call site was traced; the kit's
  existing live-cluster capture remains the wire-text evidence. No live DELETE was run against a
  real cluster in this pass (still read-only GET probes only) — `CephFsNotFound` was corrected from
  vendor source instead.

  **Q3 (breaking: removed export).** Drops `src/task.ts` and the package's `./Task` export subpath
  (`awaitTask`, `TaskRef`, `AwaitTaskOptions`, including the top-level re-export from `.`) — no
  distilled precedent for a package-level poll helper; polling belongs in the provider (Effect
  Hetzner's `actions.ts` is the upstream shape a provider-side poll should follow next). The kit's
  own `packages/alchemy/src/proxmox/distilled-task-await.test.ts`, whose sole purpose was proving
  this now-removed capability, is removed alongside it in this same PR (not a WI-4 consumer
  migration — nothing under `packages/alchemy/src/proxmox/*.ts` that isn't a test changed).

## 0.2.0

### Minor Changes

- [#185](https://github.com/taslabs-net/homeflare-kit/pull/185) [`76592a8`](https://github.com/taslabs-net/homeflare-kit/commit/76592a8fea75995e3e74a0c9f44c5e728ec9629d) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/distilled-proxmox`, an unmodified copy of the (not yet
  upstream-published) `@distilled.cloud/proxmox` SDK — 680 operations across 6
  Proxmox VE API areas (access/cluster/nodes/pools/storage/version), generated
  from PVE's own `apidata.js` (no OpenAPI document exists; this is a
  hand-written Smithy converter over the vendor's own api-viewer schema),
  pinned to the vendor's GitHub mirror commit matching this estate's
  `pve-manager` 9.2.11. Ships `catchTag`-able typed errors — the shared HTTP
  status classes, PVE's global `ParameterVerificationFailed`/`BadRequest`
  split (a bare 400 must not retry as a server error — see
  `packages/distilled-proxmox/src/protocol.ts`), and a patched
  `ClusterNodeUnreachable` (PVE's non-standard 595) on the task-management
  operations the vendor schema marks `proxyto: "node"` — plus `awaitTask`
  (`./Task`), which polls a queued action's task status until PVE's own
  `exitstatus` is exactly `"OK"`, the fix for PVE answering 200 with a bare
  task id the moment a long-running action is merely QUEUED.

  Second package on the kit's interim-package route established by
  `@homeflare/distilled-netbox` — same layout, license (Apache-2.0, a
  redistribution of `alchemy-run/distilled`'s own output), pins and smoke
  test; see `packages/alchemy/docs/distilled-interim.md`. This PR does not
  alias `@distilled.cloud/proxmox` onto it and does not move any of the kit's
  existing 98 hand-written `packages/alchemy/src/proxmox/*` resources — the
  alias can only resolve once this package is actually on npm; that migration
  is a follow-up PR. `packages/alchemy`'s dev-only `link:` dependency (for
  `src/proxmox/distilled-task-await.test.ts`) is unrelated and unchanged.
