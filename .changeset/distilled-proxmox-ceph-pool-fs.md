---
'@homeflare/alchemy': patch
---

The `proxmox/*` family's Ceph sub-area, first PR of two (decision 43's serial proxmox walk-down,
2c — the four Ceph families, split pool+fs first, daemon+osd after): migrates `Proxmox.CephPool`
fully onto `@distilled.cloud/proxmox`, and migrates `Proxmox.CephFs`'s READ and CREATE onto it
while its DELETE stays on `client.ts` for a measured protocol reason.

**Every existing refusal and guard survives byte-for-byte — this is a transport swap, not a
redesign.** Both families keep the exact single-fold read shape they always had
(`Effect.orElseSucceed` after every failure, no `output`-branching): that is NOT the newer
dual-path pattern `Proxmox.NodeNetwork`/`Proxmox.ZfsPool`/`Proxmox.Storage` carry, and it is not
upgraded to it here — this PR's own rule is behaviour surviving unchanged, not gaining the newer
pattern along the way. Both `ceph-pool-wire.ts` and `ceph-fs-distilled.ts` say so in their own
headers, including the same-day latent gap this leaves (a refused OpenBao mint still folds to
"absent" on both families, the cries-wolf class already fixed elsewhere) — noted, not fixed, since
fixing it is a behaviour change this PR's rules do not ask for.

**`Proxmox.CephPool`: the PG-merge guard, and the absence signal, both measured live.** `GET
/nodes/{node}/ceph/pool/{name}/status` on a name with no pool answers a generic HTTP 500 (measured
against TB4 `n2`, 2026-09-24, read-role, read-only probe:
`{"data":null,"message":"error with 'osd pool get': mon_cmd failed - unrecognized pool
'<name>'\n"}`) — not a parsed field like `Proxmox.NodeNetwork`'s 400, so `confirmAbsent`
(ceph-pool-settle.ts) still asks the SECOND question — does the index list this name — before a
create is allowed to run, exactly as before. `confirmAbsent` now calls distilled's
`listNodeCephPool`; the settle loop (waiting out a forked worker) never used PVE's task-status
endpoint at all — it re-polls the pool's own status, so it needed no `Task.awaitTask` and carries
no NEW protocol risk. `createNodeCephPool`/`putNodeCephPool`/`deleteNodeCephPool` map 1:1 to the
existing form (no field renames this family needed).

**`Proxmox.CephFs`: reads and create move; delete does not, for a measured reason.** Distilled
types `DeleteNodeCephFsRequest`'s `remove_pools`/`remove_storages` as request-BODY fields
(`T.Body`) — checked directly against its generated schema. This family's own header already
carries the measured fact (from PVE's own `AnyEvent.pm`) that PVE's server reads a request body
only on PUT/POST; a DELETE's body is silently discarded, no error raised anywhere. Sending those
two safety flags through distilled's generated delete op as-is would silently drop them — the same
class of protocol gap `Proxmox.NetworkApply` was kept off distilled for. `destroyFs` therefore
stays on `client.ts`, unmigrated, in `ceph-fs-wire.ts`.

The read (the directory index, `nodes.listNodeCephFs`) and the create (`nodes.updateNodeCephFs` —
distilled's generator MISNAMES the create a "update"; checked directly against its `T.Http`
annotation, it is genuinely `POST /nodes/{node}/ceph/fs/{name}`, PVE's only write on that path,
harmless once named for what it is) both move to a new `ceph-fs-distilled.ts`. The create's forked-
worker wait is its OWN function there, polling the RAW `nodes.getNodeTaskStatus` operation directly
rather than `@distilled.cloud/proxmox`'s own `Task.awaitTask` — checked against `task.ts` before
deciding: `Task.awaitTask` propagates a poll failure as a genuine typed error instead of treating
it as "not settled yet", which would turn a missing `Sys.Audit` grant or a node mid-restart into a
failed create instead of a patient one, the same failure mode `Proxmox.NetworkApply`'s own header
already names. The raw operation carries none of that behaviour — it is a plain typed GET — so
wrapping it in the SAME tolerant retry loop `ceph-fs-wire.ts`'s own (unmigrated, delete-only) poll
already uses reproduces the exact policy: same cadence (`POLL_SECONDS`/`POLL_ATTEMPTS`, one
constant, imported not retyped), same "an unreadable status is not a failure" tolerance.

**Live measurement note.** This session's own OpenBao policy has no Proxmox grant; the live probes
above ran through `homeflare-proxmox`'s `scripts/with-mini-bao.ts` (the `macmini-agent` AppRole's
`read` role for TB4), from a detached worktree, read-only, per the coordinator's direction — not
through this repo's own credentials, and nothing here reads one.

**One distilled generator quirk recorded to the shared `distilled-sdk-path.md` memory**, since it
is an upstream-distilled fact rather than a kit one: `DeleteNodeCephFsRequest` types
`remove_pools`/`remove_storages` as `T.Body` on a DELETE, which PVE's own server never reads a
body on — the same class of finding as `Proxmox.NetworkApply`'s two, worth the same upstream
attention if `@distilled.cloud/proxmox` is ever patched again.

**New tests**, both proven against a deliberately weakened check before landing:
`ceph-pool-write.test.ts` (a genuinely new pool creates once the index is confirmed empty; the
PG-merge guard refuses a create when the index lists the name but the status read still fails —
confirmed this fails without the guard by temporarily removing the `confirmAbsent` call and
re-running; `RemovalPolicy.destroy()` then undeclaring sends exactly one DELETE) and
`ceph-fs-write.test.ts` (a genuinely new filesystem POSTs, polls a forked task that answers
`running` before `stopped`/`OK` — proving the poll loop actually loops — and reads the index back;
a task that finishes with a real Ceph error dies with the task-log pointer rather than a false
create).

**Expected after this releases and the consumer bumps:** no live plan change for either family —
C1's read-role lease could always read the live Ceph objects cleanly, so this is a transport
migration on tested paths, not a behaviour change.
