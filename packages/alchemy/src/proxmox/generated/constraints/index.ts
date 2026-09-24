/**
 * Every generated Proxmox constraint table, merged — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 *
 * ⚠️ MERGING IS SAFE ONLY BECAUSE EVERY KEY IS PREFIXED `pve:`/`pbs:`. PVE and PBS both publish
 *   `PUT /access/acl` and `PUT /access/password` with DIFFERENT rules; an unprefixed merge would
 *   silently enforce one product's limits on the other's objects.
 */
import type { EndpointConstraints } from '../../constraints.ts';
import { PVE_ACCESS_CONSTRAINTS } from './pve-access.ts';
import { PVE_CLUSTER_BACKUP_CONSTRAINTS } from './pve-cluster-backup.ts';
import { PVE_CLUSTER_CEPH_CONSTRAINTS } from './pve-cluster-ceph.ts';
import { PVE_CLUSTER_FIREWALL_CONSTRAINTS } from './pve-cluster-firewall.ts';
import { PVE_CLUSTER_HA_CONSTRAINTS } from './pve-cluster-ha.ts';
import { PVE_CLUSTER_METRICS_CONSTRAINTS } from './pve-cluster-metrics.ts';
import { PVE_CLUSTER_NOTIFICATIONS_CONSTRAINTS } from './pve-cluster-notifications.ts';
import { PVE_CLUSTER_REPLICATION_CONSTRAINTS } from './pve-cluster-replication.ts';
import { PVE_CLUSTER_SDN_CONSTRAINTS } from './pve-cluster-sdn.ts';
import { PVE_NODES_CEPH_CONSTRAINTS } from './pve-nodes-ceph.ts';
import { PVE_NODES_DISKS_CONSTRAINTS } from './pve-nodes-disks.ts';
import { PVE_NODES_LXC_CONSTRAINTS } from './pve-nodes-lxc.ts';
import { PVE_NODES_NETWORK_CONSTRAINTS } from './pve-nodes-network.ts';
import { PVE_NODES_QEMU_CONSTRAINTS } from './pve-nodes-qemu.ts';
import { PVE_POOLS_CONSTRAINTS } from './pve-pools.ts';
import { PVE_STORAGE_CONSTRAINTS } from './pve-storage.ts';
import { PBS_CONFIG_CONSTRAINTS } from './pbs-config.ts';

export const PROXMOX_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  ...PVE_ACCESS_CONSTRAINTS,
  ...PVE_CLUSTER_BACKUP_CONSTRAINTS,
  ...PVE_CLUSTER_CEPH_CONSTRAINTS,
  ...PVE_CLUSTER_FIREWALL_CONSTRAINTS,
  ...PVE_CLUSTER_HA_CONSTRAINTS,
  ...PVE_CLUSTER_METRICS_CONSTRAINTS,
  ...PVE_CLUSTER_NOTIFICATIONS_CONSTRAINTS,
  ...PVE_CLUSTER_REPLICATION_CONSTRAINTS,
  ...PVE_CLUSTER_SDN_CONSTRAINTS,
  ...PVE_NODES_CEPH_CONSTRAINTS,
  ...PVE_NODES_DISKS_CONSTRAINTS,
  ...PVE_NODES_LXC_CONSTRAINTS,
  ...PVE_NODES_NETWORK_CONSTRAINTS,
  ...PVE_NODES_QEMU_CONSTRAINTS,
  ...PVE_POOLS_CONSTRAINTS,
  ...PVE_STORAGE_CONSTRAINTS,
  ...PBS_CONFIG_CONSTRAINTS,
};

/**
 * sha256 of the merged table, truncated.
 *
 * ★ A DIGEST OF THE DATA, NOT OF THE FILE TEXT, so reformatting is not a stale generation while
 *   changing a 128 to a 129 by hand is. `tests/schema-manifest.test.ts` recomputes it.
 */
export const PROXMOX_CONSTRAINTS_DIGEST = '56eba80750ddb1d2';
