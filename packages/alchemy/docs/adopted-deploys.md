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
| `Proxmox.HaResource`           | `cluster/ha/resources/{sid}`                                    | read        | shared path — no write                                                                               |
| `Proxmox.HaRule`               | `cluster/ha/rules/{rule}`                                       | read        | shared path — no write                                                                               |
| `Proxmox.SdnZone`              | `cluster/sdn/zones/{zone}`                                      | provision ¹ | shared path — no write                                                                               |
| `Proxmox.SdnVnet`              | `cluster/sdn/vnets/{vnet}`                                      | provision ¹ | shared path — no write                                                                               |
| `Proxmox.SdnSubnet`            | `cluster/sdn/vnets/{vnet}/subnets/{id}`                         | read        | shared path — no write                                                                               |
| `Proxmox.Lxc`                  | `nodes/{node}/lxc/{vmid}/config`                                | read        | shared path — no write ³                                                                             |
| `Pbs.PruneJob`                 | `config/prune/{id}`                                             | read (PBS)  | shared path — no write                                                                               |
| `Pbs.SyncJob`                  | `config/sync/{id}`                                              | read (PBS)  | shared path — no write                                                                               |
| `Pbs.VerifyJob`                | `config/verify/{id}`                                            | read (PBS)  | shared path — no write                                                                               |
| `Proxmox.Acl`                  | `access/acl` (whole list, filtered)                             | provision ¹ | shared path, then its own `bound` check — no write                                                   |
| `Pbs.Datastore`                | `config/datastore/{name}`                                       | read (PBS)  | own: GET, path/backend guards, PUT skipped on `matches`, settle GET — no write                       |
| `Proxmox.SdnApply`             | 5 × `cluster/sdn/*?pending=1` + fabrics `?pending` / `?running` | read        | own: counts staged objects; zero returns at once — **no `PUT /cluster/sdn`**                         |
| `Proxmox.CephPool`             | `nodes/{node}/ceph/pool/{name}/status?verbose=1`                | read        | own: GET, **PUT skipped on `matches` (was: always `PUT nodes/{node}/ceph/pool/{name}`)**, settle GET |

¹ These object reads are gated on an allocate privilege, so the family reads with the provision
lease (`readRole`, resource.ts). That is still a read.
² The PVE notification endpoints: `smtp` (the mail target), `sendmail`, `gotify`, `webhook`. The
secrets are never props (notification-target.ts), so no write is ever needed to "reset" them.
³ `updateForm` sends `net0`, but `matches` does not compare it. A declared `net0` that differs from
the live one is never written on a no-op adoption and never reported. The same is true of
`Proxmox.CephPool` `target_size_ratio`.

## Before the fix: `Proxmox.CephPool`

`reconcile` read the pool and, whenever it existed, PUT the declared `size`, `min_size`,
`pg_autoscale_mode`, `crush_rule` (and any declared hints) to `nodes/{node}/ceph/pool/{name}`.
That PUT forks a `cephsetpool` worker under the provision token. PVE's `set_pool` skips each
setting whose value is unchanged (Tools.pm:293-300), so a matching pool was not re-tuned. It was
still a provision-lease write and a task on the node every time the pool was adopted. TB4's task
list shows six such tasks (2026-09-13 and 2026-09-20), one per declared pool per deploy.

## How it is pinned

- `src/proxmox/ceph-pool-adopt.test.ts` runs the real CephPool provider through Alchemy's Plan
  and Apply over a fake cluster. A matching pool gets GETs only. A drifted one gets exactly one PUT.
  On the old reconcile the first test fails with that PUT.
- `src/proxmox/adopt-noop.test.ts` does the same for each reconcile shape: the shared path
  (`Proxmox.Pool`), the wrapper (`Proxmox.Acl`), and the two hand-written ones (`Pbs.Datastore`,
  `Proxmox.SdnApply`). A drifted Pool row proves the harness sees a write when there is one.
- `src/verify/verify.test.ts` pins Alchemy's own behaviour: `adopted` for a match and for a
  drift, and a reconcile for both. If an Alchemy upgrade changes that, the test fails and this
  page needs re-reading.
