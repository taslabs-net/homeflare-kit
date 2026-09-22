---
'@homeflare/alchemy': minor
---

Every Proxmox family that writes to the vendor is now checked against the vendor's own schema —
35 of 35, up from 19, covering 75 endpoints instead of 37. A family left unwired was a write this
package made with nothing between the declaration and the server's 400, which is the shape of the
2026-09-22 `deploy:pbs` incident this feature exists for.

Newly wired: `Proxmox.ApiToken`, `CephDaemon`, `CephFlag`, `CephFs`, `CephOsd`, `CephPool`, `Lxc`,
`MetricServer`, `NetworkApply`, `NodeNetwork`, `NotificationTarget`, `SdnApply`, `SdnSubnet`, `Vm`,
`ZfsPool`, and `Pbs.NotificationTarget` — which was missing from the sweep list and carries the
incident's own rule, `comment: maxLength 128`, on all three of its creates. Families that write
their own handlers (`CephOsd`, `Lxc`, the two applies, `Pbs.NotificationTarget`) reach the same
check by name through `guardForm`, as `Pbs.Datastore` already did; families with a spec declare
`endpoint`. `tests/constraint-wiring.test.ts` derives the census from the ownership ledger, so a
family added without an endpoint fails there rather than on a deploy, and each newly wired family
has a proof test that runs its REAL create form through the vendor's create table and requires no
violations.

🔴 **A live bug this found.** `Proxmox.NodeNetwork`'s create form never sent `iface`, which PVE
marks required on `POST /nodes/{node}/network` while `{node}` is its only path parameter. Every
interface create this package could have made would have 400ed; nothing caught it because the
estate's interfaces were all adopted, which takes the PUT path. `createBody` now sends it, and the
PUT still does not — there `iface` is the path.

⛔ **Presence of a vendor-required parameter is now demanded only when a create is really about to
happen**, not whenever the create form is built. `Proxmox.NotificationTarget` cannot send gotify's
`token` or smtp's `password` — they are write-only secrets and props are persisted unencrypted — so
the documented workflow is to create the target out of band and then declare it. Under the old
unconditional check that adopt-then-update would have been refused forever; now it plans clean,
while asking to CREATE a gotify target fails at plan with PVE's own `token: required`. The guards
move into `resource-guard.ts` and are exported from `pveOperations`, so `CephPool`'s hand-written
reconcile gets them too.

An **action** endpoint with no form is wired as well (`PUT /cluster/sdn`, `PUT /nodes/{node}/network`):
the table is empty, but the key is resolved against the vendor schema at generation time, so a PVE
that moves or withdraws an apply fails `bun run check` instead of an `ifreload -a` on three nodes.

`PveSpec['endpoint']` now also admits a function of props, for the two families whose endpoint is
chosen by a prop — `NotificationTarget`'s four PVE types and `CephDaemon`'s mds/mgr/mon, each with
its own parameter schema. Every key it can return is still a literal in this package's source,
because the generator finds endpoints by scanning text.

Generator changes that came with the volume: `/cluster` and `/nodes/{node}` are split one level
further down, because they are routes rather than areas — PVE's own viewer expands them — so the
tables are now 18 files (`pve-cluster-sdn.ts`, `pve-nodes-ceph.ts`, …), all inside the 250-line
house cap. The generator deletes a file it no longer produces, `tests/schema-manifest.test.ts`
enumerates the directory instead of a hand-written list and checks every table is claimed by the
manifest entry it came from, and two PVE bounds published as JSON strings (`bwlimit`'s
`minimum: "0"`, `count`'s `maximum: "16777216"`) are parsed to numbers — a faithful reading of a
stated value; a bound that is not a number at all is still dropped rather than guessed at.
