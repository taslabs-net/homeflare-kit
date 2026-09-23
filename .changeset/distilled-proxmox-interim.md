---
'@homeflare/distilled-proxmox': minor
---

Add `@homeflare/distilled-proxmox`, an unmodified copy of the (not yet
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
