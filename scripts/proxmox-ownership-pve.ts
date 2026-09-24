/**
 * The cluster-scoped PVE rows: /access, /cluster, /pools, /storage and SDN. Node-scoped
 * families (Ceph, LXC, QEMU, node networking, ZFS) are in `proxmox-ownership-pve-nodes.ts`.
 *
 * See `proxmox-ownership-shape.ts` for what a row means and why these are hand-written while
 * everything generated from them is not.
 */
import { type Ownership, P, crud, notificationEndpoints } from './proxmox-ownership-shape.ts';

export const PVE_CLUSTER_OWNERSHIP: readonly Ownership[] = [
  // ---- access ----
  {
    resource: 'Proxmox.Acl',
    system: 'pve',
    file: `${P}/acl.ts`,
    writes: [{ method: 'PUT', path: '/access/acl' }],
    refuted: [
      {
        method: 'POST',
        path: '/access/acl',
        why: 'PVE registers only PUT on the ACL collection; the spec names a collection so the shared factory type-checks.',
      },
    ],
  },
  {
    // ⛔ NO POST CLAIM, DELIBERATELY — decision 9 (2026-09-23): this family is metadata-only.
    //   `reconcile` (api-token.ts) refuses by name before any create, on every path, because PVE
    //   returns the token secret ONLY in the create response and it cannot be stored. The POST
    //   endpoint is real (the vendor schema has it) so `refuted` does not fit either — that
    //   mechanism is for endpoints the VENDOR does not implement, and the test would fail the
    //   moment this one exists, which it always has. This row spells `writes` out instead of
    //   calling `crud()` for exactly the reason that helper's own comment names ApiToken by name.
    resource: 'Proxmox.ApiToken',
    system: 'pve',
    file: `${P}/api-token.ts`,
    writes: [
      { method: 'PUT', path: '/access/users/{userid}/token/{tokenid}' },
      { method: 'DELETE', path: '/access/users/{userid}/token/{tokenid}' },
    ],
  },
  {
    resource: 'Proxmox.Group',
    system: 'pve',
    file: `${P}/group.ts`,
    writes: crud('/access/groups', '/access/groups/{groupid}'),
  },
  {
    resource: 'Proxmox.Role',
    system: 'pve',
    file: `${P}/role.ts`,
    writes: crud('/access/roles', '/access/roles/{roleid}'),
  },
  {
    resource: 'Proxmox.User',
    system: 'pve',
    file: `${P}/user.ts`,
    writes: crud('/access/users', '/access/users/{userid}'),
  },
  // ---- cluster ----
  {
    resource: 'Proxmox.BackupJob',
    system: 'pve',
    file: `${P}/backup-job.ts`,
    writes: crud('/cluster/backup', '/cluster/backup/{id}'),
  },
  {
    resource: 'Proxmox.FirewallAlias',
    system: 'pve',
    file: `${P}/firewall-alias.ts`,
    writes: crud('/cluster/firewall/aliases', '/cluster/firewall/aliases/{name}'),
  },
  {
    resource: 'Proxmox.HaResource',
    system: 'pve',
    file: `${P}/ha-resource.ts`,
    writes: crud('/cluster/ha/resources', '/cluster/ha/resources/{sid}'),
  },
  {
    resource: 'Proxmox.HaRule',
    system: 'pve',
    file: `${P}/ha-rule.ts`,
    writes: crud('/cluster/ha/rules', '/cluster/ha/rules/{rule}'),
  },
  {
    // ⚠️ POST is on the id path here too — PVE has no `/cluster/metrics/server` collection write.
    resource: 'Proxmox.MetricServer',
    system: 'pve',
    file: `${P}/metric-server.ts`,
    writes: crud('/cluster/metrics/server/{id}', '/cluster/metrics/server/{id}'),
  },
  {
    resource: 'Proxmox.NotificationMatcher',
    system: 'pve',
    file: `${P}/notification-matcher.ts`,
    writes: crud('/cluster/notifications/matchers', '/cluster/notifications/matchers/{name}'),
  },
  {
    resource: 'Proxmox.NotificationTarget',
    system: 'pve',
    file: `${P}/notification-target.ts`,
    writes: notificationEndpoints('/cluster/notifications/endpoints'),
  },
  {
    resource: 'Proxmox.ReplicationJob',
    system: 'pve',
    file: `${P}/replication-job.ts`,
    writes: crud('/cluster/replication', '/cluster/replication/{id}'),
  },
  {
    resource: 'Proxmox.Pool',
    system: 'pve',
    file: `${P}/pool.ts`,
    writes: crud('/pools', '/pools/{poolid}'),
  },
  {
    resource: 'Proxmox.Storage',
    system: 'pve',
    file: `${P}/storage.ts`,
    writes: crud('/storage', '/storage/{storage}'),
  },
  // ---- SDN ----
  {
    resource: 'Proxmox.SdnApply',
    system: 'pve',
    file: `${P}/sdn-apply.ts`,
    writes: [{ method: 'PUT', path: '/cluster/sdn' }],
  },
  {
    resource: 'Proxmox.SdnZone',
    system: 'pve',
    file: `${P}/sdn-zone.ts`,
    writes: crud('/cluster/sdn/zones', '/cluster/sdn/zones/{zone}'),
  },
  {
    resource: 'Proxmox.SdnVnet',
    system: 'pve',
    file: `${P}/sdn-vnet.ts`,
    writes: crud('/cluster/sdn/vnets', '/cluster/sdn/vnets/{vnet}'),
  },
  {
    resource: 'Proxmox.SdnSubnet',
    system: 'pve',
    file: `${P}/sdn-subnet.ts`,
    writes: crud('/cluster/sdn/vnets/{vnet}/subnets', '/cluster/sdn/vnets/{vnet}/subnets/{subnet}'),
  },
];
