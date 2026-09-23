# What a deploy does to an adopted PVE/PBS row

Traced through the source on 2026-09-21, for every family the Proxmox and PBS stacks use. A row
**without state** that the adoption probe finds is planned `adopted` and reconciled, even when
its diff said `noop` (alchemy beta.79 `Plan.ts` `forceUpdateAfterAdoption`, then `Apply.ts`).
This page answers one question: does that reconcile write when live already equals declared?

**Answer: no, for every family below. `Proxmox.CephPool` did until this change.** Its
hand-written reconcile PUT `setpool` whenever the pool existed. It now skips the PUT when its own
`matches` holds. `src/proxmox/update-guard.ts` is the one predicate that `resource.ts`,
`ceph-pool.ts` and `pbs-datastore.ts` share. `hf-adopt-verify` ([adopt-verify.md](./adopt-verify.md))
reports the diff that decides it, before the deploy.

## The shared path — every `pveHandlers` family

One `alchemy deploy` plans, then applies, in one process. For a row with no state:

| step                 | calls (path is the family's `path`)                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| plan: adoption probe | `GET path`                                                                                       |
| plan: `diff`         | `GET path`; `matches` → `noop` or `update` (printed `adopted`)                                   |
| apply: `reconcile`   | `GET path`; **PUT only when `matches` is false** and the form is non-empty; `GET path` read-back |

So a matching adoption costs **four GETs and no write**. A drifting one adds exactly one
`PUT path` carrying the family's `updateForm`. Each GET goes out on a lease, and each role's lease
is minted once per run (`lease-cache.ts`). The mint is an OpenBao call that creates a short-lived
API token on the cluster, just as it does for `alchemy plan`.

## Per family

| family                         | read path                                                       | lease       | reconcile on a no-op adoption                                                                        |
| ------------------------------ | --------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `Proxmox.Pool`                 | `pools/{poolid}`                                                | read        | shared path: GET, GET — no write                                                                     |
| `Proxmox.Storage`              | `storage/{storage}`                                             | provision ¹ | shared path — no write                                                                               |
| `Proxmox.Role`                 | `access/roles/{roleid}`                                         | read        | shared path — no write                                                                               |
| `Proxmox.Group`                | `access/groups/{groupid}`                                       | read        | shared path — no write                                                                               |
| `Proxmox.User`                 | `access/users/{userid}`                                         | read        | shared path — no write                                                                               |
| `Proxmox.BackupJob`            | `cluster/backup/{id}`                                           | read        | shared path — no write                                                                               |
| `Proxmox.MetricServer`         | `cluster/metrics/server/{id}`                                   | read        | shared path — no write                                                                               |
| `Proxmox.NotificationTarget` ² | `cluster/notifications/endpoints/{type}/{name}`                 | read        | shared path — no write                                                                               |
| `Proxmox.NotificationMatcher`  | `cluster/notifications/matchers/{name}`                         | read        | shared path — no write                                                                               |
| `Proxmox.HaResource`           | `cluster/ha/resources/{sid}`                                    | read        | shared path — no write                                                                               |
| `Proxmox.HaRule`               | `cluster/ha/rules/{rule}`                                       | read        | shared path — no write                                                                               |
| `Proxmox.SdnZone`              | `cluster/sdn/zones/{zone}`                                      | provision ¹ | shared path — no write                                                                               |
| `Proxmox.SdnVnet`              | `cluster/sdn/vnets/{vnet}`                                      | provision ¹ | shared path — no write                                                                               |
| `Proxmox.SdnSubnet`            | `cluster/sdn/vnets/{vnet}/subnets/{id}`                         | read        | shared path — no write                                                                               |
| `Proxmox.Lxc` ³                | `nodes/{node}/lxc/{vmid}/config`                                | read        | own: GET, `judge` finds no drift so no `PUT …/config`, GET — no write                                |
| `Pbs.PruneJob`                 | `config/prune/{id}`                                             | read (PBS)  | shared path — no write                                                                               |
| `Pbs.SyncJob`                  | `config/sync/{id}`                                              | read (PBS)  | shared path — no write                                                                               |
| `Pbs.VerifyJob`                | `config/verify/{id}`                                            | read (PBS)  | shared path — no write                                                                               |
| `Pbs.NotificationMatcher`      | `config/notifications/matchers/{name}`                          | read (PBS)  | shared path — no write                                                                               |
| `Pbs.NotificationTarget` ⁵     | `config/notifications/endpoints/{type}/{name}`                  | read (PBS)  | own: GET, PUT only for a stale group, GET — no write                                                 |
| `Proxmox.Acl`                  | `access/acl` (whole list, filtered)                             | provision ¹ | shared path, then its own `bound` check — no write                                                   |
| `Pbs.Datastore`                | `config/datastore/{name}`                                       | read (PBS)  | own: GET, path/backend guards, PUT skipped on `matches`, settle GET — no write                       |
| `Proxmox.SdnApply`             | 5 × `cluster/sdn/*?pending=1` + fabrics `?pending` / `?running` | read        | own: counts staged objects; zero returns at once — **no `PUT /cluster/sdn`**                         |
| `Proxmox.CephPool` ⁴           | `nodes/{node}/ceph/pool/{name}/status?verbose=1`                | read        | own: GET, **PUT skipped on `matches` (was: always `PUT nodes/{node}/ceph/pool/{name}`)**, settle GET |
| `Proxmox.CephDaemon` ⁶         | `nodes/{node}/ceph/{mon,mgr,mds}` (whole list, by `name`)       | read        | shared path, and no `updateForm`: GET, GET — no write                                                |
| `Proxmox.CephFs` ⁶             | `nodes/{node}/ceph/fs` (whole list, by `name`)                  | read        | own: GET, present so returned untouched — no write                                                   |
| `Proxmox.CephOsd` ⁶            | `nodes/{node}/ceph/osd` (the CRUSH tree)                        | read        | own: GET, host/class asserted; POSTs only with `dev` declared — no write                             |
| `Proxmox.ApiToken` ⁷           | `access/users/{userid}/token/{tokenid}`                         | provision ¹ | shared path — PUT skipped on `matches`; POST refused (`reconcile` dies rather than mint one)         |
| `Proxmox.ZfsPool` ⁷            | `nodes/{node}/disks/zfs/{name}`                                 | read        | own: GET; no PUT exists on this family; POST only with `devices` AND `raidlevel` both declared       |

¹ These object reads are gated on an allocate privilege, so the family reads with the provision
lease (`readRole`, resource.ts). That is still a read.
² The PVE notification endpoints: `smtp` (the mail target), `sendmail`, `gotify`, `webhook`. The
secrets are never props (notification-target.ts), so no write is ever needed to "reset" them.
³ Rewritten 2026-09-21 (PR 80, [proxmox-lxc.md](./proxmox-lxc.md)): its own reconcile, and its
probe answers `Unowned`, so the deploy needs `--adopt`. An adoption that would write fails the
plan instead, naming the keys ([proxmox-lxc-adopt.md](./proxmox-lxc-adopt.md)), so only the
no-write row applies. Pinned by `src/proxmox/lxc-adopt.test.ts` ("deploys with no write") and
`src/proxmox/lxc-strict-adopt.test.ts`.
⁴ `updateBody` sends `target_size_ratio`, but `matches` does not compare it (float equality). A
declared ratio that differs from the live one is never written on a no-op adoption and never
reported as a diff.

⁵ Its own `diff` and `reconcile`, because a secret's value is not in the live object: the plan
compares a seal kept in the previous state ([pbs-notifications.md](./pbs-notifications.md)). An
adopted target has no seal, so its secret values are presence-only and adoption writes nothing.
Pinned by `src/proxmox/pbs-notification-target-state.test.ts`.

⁶ Exported from the barrel 2026-09-22. None has a PUT, and CephDaemon and CephFs compare nothing,
so a present object is `noop` and can never plan a replace. All three retain on destroy: removing
the declaration plans `orphaned` and sends no DELETE. `Proxmox.CephFlag` stays Provider-only (a
declared flag reasserts a maintenance toggle on every deploy). Pinned by
`src/proxmox/ceph-adopt.test.ts`, whose mutation check (retain flipped to destroy) shows nine
DELETEs, one per mon, mgr and mds.

⁷ Exported from the barrel 2026-09-23, decision 9. Both refuse to CREATE what they do not already
have: ApiToken's `reconcile` dies by name rather than mint a secret it cannot store (api-token.ts);
ZfsPool's `createPool` dies by name when `devices`/`raidlevel` are undeclared and the pool is not
already there (zfs-pool-write.ts) — the adopt-only shape a stripe pool such as n1's `speed` needs,
since PVE's own `raidlevel` enum has none. Pinned by `src/proxmox/api-token-adopt.test.ts` and
`src/proxmox/zfs-pool-adopt.test.ts`, whose mutation rows show one PUT and one DELETE respectively.

## Before the fix: `Proxmox.CephPool`

`reconcile` read the pool and, whenever it existed, PUT the declared `size`, `min_size`,
`pg_autoscale_mode`, `crush_rule` (and any declared hints) to `nodes/{node}/ceph/pool/{name}`.
That PUT forks a `cephsetpool` worker under the provision token. PVE's `set_pool` skips each
setting whose value is unchanged (Tools.pm:293-300), so a matching pool was not re-tuned. It was
still a provision-lease write and a task on the node every time the pool was adopted. C1's task
list shows six such tasks (2026-09-13 and 2026-09-20), one per declared pool per deploy.

## How it is pinned

- `src/proxmox/ceph-pool-adopt.test.ts` runs the real CephPool provider through Alchemy's Plan
  and Apply over a fake cluster. A matching pool gets GETs only. A drifted one gets exactly one PUT.
  On the old reconcile the first test fails with that PUT.
- `src/proxmox/adopt-noop.test.ts` does the same for each reconcile shape: the shared path
  (`Proxmox.Pool`), the wrapper (`Proxmox.Acl`), and the two hand-written ones (`Pbs.Datastore`,
  `Proxmox.SdnApply`). A drifted Pool row proves the harness sees a write when there is one.
- `src/proxmox/ceph-adopt.test.ts` adopts a reference cluster's nine daemons, one CephFS and six
  OSDs (GETs only), undeclares all sixteen (no DELETE), and refuses an OSD on the wrong host
  without a write.
- `src/proxmox/api-token-adopt.test.ts` adopts four token shapes read-only, refuses an absent
  token, and shows a `privsep` flip PUTs exactly `comment`/`expire`/`privsep` once.
- `src/proxmox/zfs-pool-adopt.test.ts` adopts five adopt-only pools read-only, refuses an absent
  or vanished one before any POST, and shows `RemovalPolicy.destroy()` then undeclaring sends
  exactly one DELETE.
- `src/verify/verify.test.ts` pins Alchemy's own behaviour: `adopted` for a match and for a
  drift, and a reconcile for both. If an Alchemy upgrade changes that, the test fails and this
  page needs re-reading.
