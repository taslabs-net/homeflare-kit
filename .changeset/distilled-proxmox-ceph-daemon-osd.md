---
'@homeflare/alchemy': patch
---

The `proxmox/*` family's Ceph sub-area, second of two PRs for 2c (decision 43's walk-down): migrates
`Proxmox.CephDaemon` (mon/mgr/mds) and `Proxmox.CephOsd` fully onto `@distilled.cloud/proxmox`.
Neither family had a forked-worker settle loop or an envelope-stripping dependency, so unlike
`Proxmox.NetworkApply`/`Proxmox.CephFs`'s delete, there is no protocol-level reason to leave either
on `client.ts` — both move completely.

**`Proxmox.CephDaemon`** replaces the generic `pveOperations`/`pveHandlers` factory (which cannot
run a distilled typed operation) with hand-written `read`/`diff`/`reconcile`/`delete`, matching the
factory's own pre-migration shape exactly: `matches` was always `() => true` and there is no PUT
for any of the three kinds, so a live daemon is always `noop` and drift is always `update`, never a
diff no write could satisfy. `nodes.updateNodeCephMon`/`Mgr`/`Mds` are distilled's generator
misnaming the create a POST "update" (checked against each one's `T.Http` annotation before
trusting the name); `nodes.listNodeCephMon`/`Mgr`/`Mds` and `nodes.deleteNodeCephMon`/`Mgr`/`Mds`
are the read and delete. One field rename: mon's `mon-address` maps to distilled's `mon_address`
(`T.Body("mon-address")`, confirmed against the schema) — the same one-key pattern
node-network-form.ts's `RENAMED` table carries for three fields.

**`Proxmox.CephOsd`** keeps its own pre-migration read behaviour exactly: `readOsd` (ceph-osd-tree.ts)
still has NO `Effect.orElseSucceed` — the tree endpoint is a collection that always exists while
Ceph is installed, so a read failure is never "the OSD is gone" and must propagate, never fold. This
is the one migrated Ceph family that does NOT match the single-fold shape `Proxmox.CephPool`/
`Proxmox.CephDaemon` carry, because it never had it before this PR either. `nodes.getNodeCephOsd`
(the tree), `nodes.createNodeCephOsd` and `nodes.deleteNodeCephOsd` map 1:1 to the existing forms.

**Both families keep every existing refusal byte-for-byte.** `Proxmox.CephOsd`'s create and delete
remain unreachable through this package's own credential — PVE registers `createosd`/`destroyosd`
with NO permissions block at all (root@pam only), confirmed again against distilled's own generated
schema, which changes nothing about that restriction. `Proxmox.CephDaemon`'s destroy still runs
against the daemon's own id path, never the collection `read` uses, avoiding the 501-that-looks-
like-a-permission-problem the pre-migration header already warned about.

**One pre-existing, out-of-scope finding, carried forward exactly rather than fixed here:**
`Proxmox.CephOsd`'s `destroyOsd` sends its `cleanup` flag as a request BODY on a DELETE, on
`client.ts` before this PR and on distilled after it alike — `client.ts`'s own `buildRequest` puts
`form` in the body for every HTTP method, and distilled's generated `DeleteNodeCephOsdRequest`
carries no `T.Query()` annotation on `cleanup` either, so it defaults to the same place. PVE's own
server (measured from `AnyEvent.pm`, the same fact `Proxmox.CephFs`'s delete was kept off distilled
for) never reads a body on DELETE — so `cleanup=1` was ALREADY silently ignored by the live cluster
before this migration. This is not a new regression, so it is not a reason to keep `destroyOsd` off
distilled the way `Proxmox.CephFs`'s delete was — but it is a real bug, unrelated to this PR, flagged
separately for its own fix (move `cleanup` into the query string, the way `destroyPath` in
ceph-fs-wire.ts already does for CephFs's own flags). It has zero live impact today either way,
since the whole DELETE 403s for this package's credential regardless of `cleanup`.

**One adversarial-review finding, fixed.** The hand-written `reconcile` returned early on
`if (live !== undefined) return live;` BEFORE calling `guardWrite` — the pre-migration factory
(`pveOperations.reconcile`, resource.ts) ran its create/update guard unconditionally right after
the read, because `reconcile` also runs for an ADOPTED row with no fresh `diff` first (Plan.ts
forces it after the probe even when `diff` said noop). Inert today, since `diff` guards every
normal plan — but a real gap for any caller that invokes `reconcile` directly (a resumed apply
from persisted state, a verify/adopt harness). Fixed to match `node-network.ts`'s own `reconcile`:
`guardWrite` now runs immediately after the read, unconditionally. `reconcileDaemon` is exported
so a test can call it directly, bypassing `diff` the same way the gap would have been reached.

**A related, separate finding, NOT fixed here — recorded to `decisions.md`'s open items.** Proving
the guard fix with an actual refused value turned up that `constraints.ts`'s `violations()` never
checks a bare `format` rule: `mon-address`'s own vendor entry is `{"format":"ip-list",
"type":"string"}` with no `pattern`, and checked directly, `formViolations` returns `[]` for a
malformed address. `mds`/`mgr`'s create endpoints carry EMPTY constraint tables too. About 105
parameters across this whole package declare a `format`; none are enforced. This is a real,
pre-existing gap unrelated to distilled or this migration — the new test instead proves the
STRUCTURAL property (`guardWrite`, and the `createForm` it must evaluate, still run on the
adopted-row path, via a field getter that only `createForm` reads on that path), confirmed to fail
without the ordering fix by temporarily reverting it and re-running.

**New tests**, proven against a deliberately broken implementation before landing:
`ceph-daemon-write.test.ts` (a new mon POSTs `mon-address` as `mon_address` and reads the collection
back; a new mds POSTs `hotstandby`; `RemovalPolicy.destroy()` then undeclaring a mgr sends exactly
one DELETE — confirmed to fail without the real `deleteDaemon` call by temporarily stubbing it out)
and `ceph-osd-write.test.ts` (a new OSD POSTs `dev` and `crush-device-class` correctly and reads the
new leaf back by id — this test can never run against the real cluster, since the write it drives is
root-only, but it is the only way to catch a wire-translation bug a real deploy would never reach far
enough to expose).

**Expected after this releases and the consumer bumps:** no live plan change for either family — C1's
read-role lease could always read the live Ceph daemons and OSDs cleanly, so this is a transport
migration on tested paths, not a behaviour change.
