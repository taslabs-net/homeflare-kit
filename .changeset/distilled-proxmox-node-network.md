---
'@homeflare/alchemy': patch
---

The `proxmox/*` family's `nodes/storage` sub-area, third resource (decision 43's serial proxmox
walk-down, after `access` in PR 231/239, `storage` in PR 243 and `ZfsPool` in PR 246): migrates
`Proxmox.NodeNetwork` off `client.ts`'s hand-rolled `pve()`/`pveHandlers` onto
`@distilled.cloud/proxmox`'s typed `nodes.getNodeNetwork`/`createNodeNetwork`/`putNodeNetwork2`/
`deleteNodeNetwork2`. Split into `node-network.ts` (the resource and its provider),
`node-network-wire.ts` (the read side — `readInterfaceOrFail`/`readInterface`, `matches`,
`attributesOf`) and `node-network-form.ts` (`NodeNetworkProps`, the write side, and the
coercion helpers both other files need) — the storage.ts/storage-form.ts seam.

**`Proxmox.NetworkApply` stays on `client.ts`, deliberately, not migrated with this PR.** Decision
28/29/9 ("NetworkApply stays an operator step") plus two MEASURED reasons, checked directly
against `@distilled.cloud/proxmox`'s own source before deciding, not assumed:

1. `network-apply-read.ts`'s `stagedDiff` reads the ONLY signal this family has for "is anything
   staged" — `changes`, a SIBLING of `data` in PVE's own envelope
   (`{"data":[...],"changes":"<unified diff>"}`), not inside it. `@distilled.cloud/proxmox`'s
   `protocol.ts` `transformResponse` unconditionally returns `body.data ?? {}` for EVERY operation
   on the protocol, discarding any sibling field before a generated operation's typed output is
   even built. There is no typed call, current or future, that could see `changes` without a
   protocol-level change upstream in the distilled package itself.
2. `network-apply-read.ts`'s hand-rolled `awaitTask` deliberately collapses a failed poll to
   "outcome unknown" rather than "task failed", because the member serving the poll can be the
   very node whose reload just dropped the connection the poll rides on. `@distilled.cloud/
proxmox`'s own `Task.awaitTask` (`src/task.ts`) does not have this behaviour — it propagates a
   poll failure as a genuine typed `GetNodeTaskStatusError`, which would fail `NetworkApply`'s
   `reconcile` outright on the one failure mode it most needs to tolerate.

Both gaps are documented in `network-apply-read.ts`'s own header now, next to the functions they
affect. Revisit when distilled's protocol layer exposes the raw envelope, or its `awaitTask` grows
an option to treat a poll failure as unknown rather than fatal.

**A missing interface is a 400, not a 404 and not the 500 every other migrated family has** —
MEASURED against the live cluster (TB4 `n2`, read-role, read-only probe): `GET
/nodes/n2/network/vmbr9` answers `{"errors":{"iface":"interface does not exist"},"data":null,
"message":"Parameter verification failed.\n"}` at HTTP 400. `@distilled.cloud/proxmox` types PVE's
400 as a genuine typed error, `ParameterVerificationFailed`, carrying the per-field `errors`
object rather than collapsing it to an opaque `BadRequest`. Only that exact signal —
`error.errors.iface === 'interface does not exist'` — means absent; a different 400 reason, a
genuine 500, or a network blip all propagate as real failures rather than being read as "gone".

**A precise absence signal does not remove the need for the dual-path read.** A first draft
reasoned that a parsed, specific absence signal made `readXOrFail`/folding-`readX` and `read`'s
`output`-branching unnecessary — every other migrated family carries that pair for the
`Drift.ts` gap, but this family's absence check already rejects anything that is not the exact
measured 400, so nothing wrongly propagates as absence. A Sonnet adversarial review caught the
flaw: precision of the absence signal and safety of folding at a given call site are separate
questions. Three of Alchemy's four `read` call sites (`Plan.ts`'s cold-start adoption probe,
`Plan.ts`'s interrupted-create recovery, `Apply.ts`'s delete recovery) call `provider.read` with
no state to compare against yet and no catch of their own around a typed failure — and `Plan.ts`
aggregates every resource's diff/probe effects fail-fast, so one resource's malformed or
transiently-failing declaration would abort the whole plan. Folding at those sites is what turns
that into a normal `create`/`noop` instead. Fixed by restoring the pair:
`readInterfaceOrFail` (non-folding, used by `diff` always and by `reconcile`'s write path) and
`readInterface` (folding, used by `read` when `output` is `undefined`, mirroring
user.ts/group.ts/storage.ts/zfs-pool.ts). `node-network-wire.ts`'s own header on both functions
has the full reasoning.

**TB4's fabric ports stay excluded, unchanged.** `tb0`/`tb1`/`dummy_c1` (the Thunderbolt mesh
SdnFabric owns, per decision 28/29/9) were never declared through this family and still are not —
this migration touches only how an interface this family DOES manage gets read and written, never
what gets declared through it. The header's own warning about them is carried forward verbatim,
now with an explicit pointer to decision 28/29/9.

Bugs caught before opening the PR, all fixed: an early draft's `diff` forgot to call
`unreadableWarning` on a refused-credential row (every OTHER migrated family logs it; this one
silently didn't) — self-caught, re-running the full test suite, fixed and now covered by
`node-network-read-failure.test.ts`'s own cries-wolf test. An unused import
(`ParameterVerificationFailed` imported as a value, needed only as the string tag
`Effect.catchTag` matches against) — caught by the pre-commit lint gate. And the dual-path
regression above — caught by the adversarial review, not self-caught.

`node-network-read-failure.test.ts` (new — this family had no dedicated test file before this
migration, only the create-form's vendor-constraint proof in `constraints-host-forms.test.ts`)
pins the cries-wolf fix, the precise absence signal (a genuinely new interface creates from
exactly that 400; a different 400 and a genuine 500 both propagate instead of creating), and the
`alchemy drift` fix. Each assertion was confirmed to fail against a deliberately weakened check
before landing (the "different 400 propagates" test specifically catches a version of the absence
check that matches any 400, not just the measured one).

**Expected after this releases and the consumer bumps:** no live plan change is expected for
`Proxmox.NodeNetwork` specifically — its `read`-role lease could always read the family's three
declared interfaces cleanly, so this is a transport migration plus a defensive fix for a bug class
not yet measured live for this family. `Proxmox.NetworkApply`'s own plan is unaffected, since it
is untouched by this PR.
