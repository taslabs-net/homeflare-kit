# PVE/PBS SDK migration

2026-09-24. Transport completion and live adoption are separate gates. The interim
SDKs follow [the distilled route](./distilled-interim.md): generated vendor schemas,
local distilled fixes first, verbatim source copies, and published npm aliases.

## Implemented transport

Twenty-one existing PVE resource families use named distilled operations throughout:
ACL, ApiToken, BackupJob, CephDaemon, CephFs, CephOsd, CephPool, FirewallAlias, Group,
Lxc, MetricServer, NodeNetwork, NotificationMatcher, NotificationTarget, Pool,
ReplicationJob, Role, Storage, User, Vm and ZfsPool. All six existing PBS families now
do too: Datastore, NotificationMatcher,
NotificationTarget, PruneJob, SyncJob and VerifyJob.

The latest migration preserves credential leases, safe member failover, bounded
polling, vendor constraints, write-only secret handling and existing state shapes.
The newly migrated pool, metric, job and notification providers fold only typed
missing-resource errors to absence; their other SDK failures propagate.
Protocol fixtures exercise the generated operations; Alchemy engine tests prove
matching adoption does not write and a real update settles to a no-op.
[Replication and alias evidence](./proxmox-replication-firewall-distilled.md) records
precise absence, async replica cleanup, comment clearing and identity replacement.

The SDK patches record PVE 9.2.11 source and PBS 4.2.6-1 schema provenance. Read-only
probes against PVE 9.2.11 and PBS 4.2.3 distinguish notification HTTP404 responses
from PBS configuration HTTP400 responses. Resource providers do not inspect status
codes or message text to make that distinction.

## Consumer gate

These families cover the default TB4/HF-Ops/PBS adoption declarations in
`homeflare-proxmox` at commit `91b31b0`. Its opt-in vault-door Lxc now has
[SDK transport](./proxmox-lxc-distilled.md); live creation remains a separate gate.
This source migration alone does not establish live adoption.
After both SDKs and the provider release publish, the consumer pins those exact
versions, runs its full check and all three adoption verifiers, then compares the
read and admin plans at stage `live`. A write requires a fresh matching proof.

## Remaining PVE families

Eight existing families still retain some hand-client transport: NetworkApply,
SdnApply, SdnZone, SdnVnet, SdnSubnet, HaResource, HaRule and CephFlag.
Their previous measured-none records
are historical inventories, not a current census or permission to skip migration.

- NetworkApply needs the `changes` sibling beside the response's `data`; generic
  unwrapping discards it. Fix the distilled protocol/schema boundary before moving
  this read. The network diff can contain secrets and must not enter state or logs.
- SdnApply distinguishes an unavailable subsystem from failed reads and refuses
  undiffable settings. Those semantics need vendor-backed typed SDK errors.
- Vm (QEMU) uses named operations. GET and PUT stay on
  `/nodes/{node}/qemu/{vmid}/config`. DELETE is `destroy_vm` at
  `/nodes/{node}/qemu/{vmid}`. Absence is `QemuConfigNotFound` from AbstractConfig's
  missing `qemu-server/{vmid}.conf` sentence, and a cluster guest index check refuses
  a vmid held elsewhere before create.

Complete vendor coverage additionally requires a census of families not yet modeled
as resources. The 27 migrated families above are a transport milestone, not that
larger completion claim. No changes were pushed or submitted to upstream repositories.

Existing NodeNetwork and ZfsPool adoption/reconcile reads still contain broad failure
folds. Their strict diff reads do not remove that separate conformance gap. CephFs
task polling also tolerates temporary read failures, but uses a bounded uncertainty
policy rather than treating a resource as absent.
