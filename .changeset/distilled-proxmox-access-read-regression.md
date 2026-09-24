---
'@homeflare/alchemy': patch
---

Fixes a live regression from kit 0.31.1 (PR 231, the `proxmox/access`
distilled migration): on the agent (`read`-role) lane, `bun run plan` showed
every `Proxmox.User`/`Proxmox.Group` row as `update` with no warning — a
silent false diff, not the loud "read was refused" case that migration was
meant to fix.

**Root cause, measured against the live cluster.** `user.ts`/`group.ts`
called `access.getAccessUser(props)`/`access.getAccessGroup(props)` with the
whole declared props object, not just the schema's own `{userid}`/
`{groupid}` label field. distilled's `buildRequest` treats any OTHER key on
that object (`target`, `comment`, every other prop this family carries) as
an "unknown key" and JSON-encodes it onto the request as a body — on what
must stay a bodyless GET. A permissive client tolerates this; Node/Bun's own
`fetch` refuses it outright
(`TypeError [ERR_INVALID_ARG_VALUE]: fetch() request with GET/HEAD method
cannot have body`), which `runPveWith` retried across every cluster member
and exhausted identically (`PveClusterExhausted`). The old
`Effect.orElseSucceed(() => undefined)` then folded that failure into
"absent", forcing a false `update` on every account and every group — the
same cries-wolf bug PR 231 had just fixed for a refused credential, now
triggered by a genuine transport failure instead. Fixed by calling both
operations with only their declared label field.

**The fold itself was too broad, independent of the request-shape bug.**
`orElseSucceed` turning ANY read failure into "absent" is unsound at `diff`
time: only a genuine not-found may mean absent, every other failure must
fail the plan loudly rather than silently forcing a write. `acl.ts` (already
migrated pre-231) and `role.ts` never needed a fold at all — an ACL/role's
absence is always a successful list read that just doesn't contain the row,
so any thrown failure was already a bug; the fold there is now removed
outright. `api-token.ts`'s absence signal is likewise a measured
success-path check (`expire`/`privsep` both undefined on a 200), so its
fold is also removed outright.

`user.ts`/`group.ts` are different: a genuinely missing user or group is a
thrown 500 on this cluster (`"no such user"`/`"no such group"`, not a clean
404), MEASURED live — so `reconcile`'s create workflow still needs "absent"
derived from exactly that failure, or a brand-new declaration could never be
created. Each now has a dual-path read in its `*-wire.ts` sibling: a
non-folding `read...OrFail` (used by `diff`, so a genuine transient failure
propagates and fails the plan loudly) and a folding wrapper kept only for
`read`/`reconcile` (where folding costs at most a redundant, loudly-refused
create, never a silent wrong write).

**A second, deeper instance of the same bug class, found by adversarial
review of this fix rather than measured live.** The engine calls a
provider's `read` hook from four places — an adoption probe and
interrupted-create recovery in `Plan.ts`, delete recovery in `Apply.ts`, and
`Drift.ts` (`alchemy drift`/`sync`/`deploy --detect-drift`) — and only the
first three are "nothing confirmed exists yet" cases where `read`'s own
fold is safe. `Drift.ts` calls `read` on an ALREADY-CONFIRMED row (its own
persisted `output`), the same situation `diff` handles, and a folded
failure there is reported as `{action: 'missing'}` with no error anywhere —
worse than the original bug, since nothing even logs a warning. Fixed by
having `user.ts`/`group.ts`'s `read` hook branch on the input's own
`output` field (documented on `Provider.read`'s own type as "current state
-> synced state"): `output === undefined` still uses the folding read
(unchanged, for the three recovery/adoption cases), `output !== undefined`
now uses the same non-folding `read...OrFail` `diff` already calls.

`read-failure-propagation.test.ts` pins all three fixes end to end against
real-shaped PVE fixtures (live response bodies, nothing secret): a GET that
would carry a body now fails the assertion outright; a transient 500 on an
already-adopted `Proxmox.User`/`Proxmox.Group` now rejects `verify()`
instead of resolving with a false `update`; and (a new `drift` capability
on the shared `fake-engine.ts` test harness, driving the real
`Alchemy.Drift.detect`) the same transient failure now rejects `alchemy
drift` instead of silently reporting the resource missing — each of the
three new/changed tests was confirmed to fail against the pre-fix code
before this change landed.

**Expected after this releases and the consumer bumps:** on the agent
lane, `bun run plan`'s users/groups return to `noop`, ACLs stay
`noop`-with-warning, and the five pre-existing storage rows (a separate,
not-yet-migrated family) are unaffected.
