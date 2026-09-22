/**
 * Proxmox providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY.
 *   These are the symbols a real stack consumes; the rest of the files are internals a
 *   provider needs but a consumer should not depend on. An `export *` here would publish
 *   every helper as API and make the next refactor a breaking change.
 * ★ Control-plane Resource constructors (Storage, SDN, access, HA, backup,
 *   metrics, PBS) sit next to their Providers. NIC apply and QEMU stay
 *   Provider-only so a stack cannot declare them by accident.
 * ★ `ProxmoxLxc` JOINED THEM 2026-09-21, AND IT WAS KEPT OFF UNTIL IT COULD NOT HURT A GUEST.
 *   The provider-only version diffed four fields and would have planned a create over any read
 *   failure. The Resource now adopts from the live config, refuses every change PVE cannot make
 *   in place, and retains on destroy (lxc.ts).
 * ★ THE PROVISIONING BASELINE JOINED 2026-09-21: one privilege list (`PROVISION_PRIVILEGES`), the
 *   helper that declares it (`declareProvisionBaseline`) and the pure generator of the one-time
 *   root commands that bootstrap it (`provisionBootstrap`) — docs/provision-baseline.md.
 * ★ THE NOTIFICATION FAMILIES JOINED 2026-09-22: PBS targets and matchers, the PVE matcher, the
 *   `FromEnv` shape their write-only values take, and the Alertmanager body template
 *   (docs/pbs-notifications.md; the template alone: docs/pbs-alertmanager-body.md).
 * ★ Anything else unlisted is still reachable by path if you genuinely need
 *   it — that is a deliberate, visible act rather than an accident of barrelling.
 */
export { ProxmoxAcl, ProxmoxAclProvider } from './acl.ts';
export { type AlertmanagerBodyOptions, alertmanagerAlertBody } from './alertmanager-body.ts';
export { ProxmoxApiTokenProvider } from './api-token.ts';
export { ProxmoxBackupJob, ProxmoxBackupJobProvider } from './backup-job.ts';
export { ProxmoxCephDaemonProvider } from './ceph-daemon.ts';
export { ProxmoxCephFlagProvider } from './ceph-flag.ts';
export { ProxmoxCephFsProvider } from './ceph-fs.ts';
export { ProxmoxCephOsdProvider } from './ceph-osd.ts';
export { ProxmoxCephPool, ProxmoxCephPoolProvider } from './ceph-pool.ts';
export { ProxmoxFirewallAliasProvider } from './firewall-alias.ts';
export { ProxmoxGroup, ProxmoxGroupProvider } from './group.ts';
export { ProxmoxHaResource, ProxmoxHaResourceProvider } from './ha-resource.ts';
export { ProxmoxHaRule, ProxmoxHaRuleProvider } from './ha-rule.ts';
export { type LxcAttributes, type LxcProps, ProxmoxLxc, ProxmoxLxcProvider } from './lxc.ts';
export { ProxmoxMetricServer, ProxmoxMetricServerProvider } from './metric-server.ts';
export { ProxmoxNetworkApplyProvider } from './network-apply.ts';
export { ProxmoxNodeNetworkProvider } from './node-network.ts';
export {
  ProxmoxNotificationMatcher,
  ProxmoxNotificationMatcherProvider,
} from './notification-matcher.ts';
export {
  ProxmoxNotificationTarget,
  ProxmoxNotificationTargetProvider,
} from './notification-target.ts';
export { PbsDatastore, PbsDatastoreProvider } from './pbs-datastore.ts';
export {
  PbsNotificationMatcher,
  PbsNotificationMatcherProvider,
} from './pbs-notification-matcher.ts';
export {
  PbsNotificationTarget,
  PbsNotificationTargetProvider,
  type PbsNotificationTargetProps,
} from './pbs-notification-target.ts';
export { PbsPruneJob, PbsPruneJobProvider } from './pbs-prune-job.ts';
export { PbsSyncJob, PbsSyncJobProvider } from './pbs-sync-job.ts';
export { PbsVerifyJob, PbsVerifyJobProvider } from './pbs-verify-job.ts';
export { ProxmoxPool, ProxmoxPoolProvider } from './pool.ts';
export {
  PROVISION_DEFAULTS,
  PROVISION_PRIVILEGES,
  type ProvisionBaseline,
  type ProvisionLane,
  type ProvisionNames,
  type ResolvedProvisionNames,
  provisionBaseline,
} from './provision-baseline.ts';
export { provisionBootstrap } from './provision-bootstrap.ts';
export { type DeclareProvisionOptions, declareProvisionBaseline } from './provision-declare.ts';
export { ProxmoxVmProvider } from './qemu.ts';
export { ProxmoxReplicationJobProvider } from './replication-job.ts';
export { ProxmoxRole, ProxmoxRoleProvider } from './role.ts';
export { ProxmoxSdnApply, ProxmoxSdnApplyProvider } from './sdn-apply.ts';
export { ProxmoxSdnSubnet, ProxmoxSdnSubnetProvider } from './sdn-subnet.ts';
export { ProxmoxSdnVnet, ProxmoxSdnVnetProvider } from './sdn-vnet.ts';
export { ProxmoxSdnZone, ProxmoxSdnZoneProvider } from './sdn-zone.ts';
export { ProxmoxStorage, ProxmoxStorageProvider } from './storage.ts';
export { ProxmoxUser, ProxmoxUserProvider } from './user.ts';
export { type FromEnv } from './write-only.ts';
export { ProxmoxZfsPoolProvider } from './zfs-pool.ts';
