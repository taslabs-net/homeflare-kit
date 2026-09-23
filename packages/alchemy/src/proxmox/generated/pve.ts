/**
 * Generated pve-manager API types — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * 678 endpoints, 1059 exported types: EVERY endpoint the vendor
 * documents, not a subset. The generator this replaced covered a fraction of them and no committed
 * file said which fraction or why.
 *
 * ⚠️ 480 request parameters are typed `\`${number}\`` because the vendor calls them
 *   integer or number. They were `string` before, which accepted 'banana'. A caller holding a
 *   number writes \`${n}\` — `String(n)` is a plain `string` and will not typecheck, deliberately.
 *
 * ⛔ 135 OF THESE NAMES ARE ALSO EXPORTED BY `pbs.ts`, MEANING SOMETHING ELSE. Both
 *   products document a `/nodes/{node}` subtree, so a name like `NodesNodeCertificatesGetReturn`
 *   exists on each side — here an array of objects, there `null`. Nothing stops a pbs call
 *   importing the pve spelling: it compiles, and the type is simply wrong about the payload.
 *   Import from the barrel that names your product. tests/schema-types.test.ts pins this count, so
 *   a vendor upgrade that adds a collision fails there rather than at runtime.
 */
export * from './pve/access.ts';
export * from './pve/access-roles.ts';
export * from './pve/access-users.ts';
export * from './pve/cluster.ts';
export * from './pve/cluster-acme-plugins.ts';
export * from './pve/cluster-acme-plugins-id.ts';
export * from './pve/cluster-acme-tos.ts';
export * from './pve/cluster-bulk-action.ts';
export * from './pve/cluster-firewall.ts';
export * from './pve/cluster-firewall-refs.ts';
export * from './pve/cluster-ha.ts';
export * from './pve/cluster-jobs.ts';
export * from './pve/cluster-metrics.ts';
export * from './pve/cluster-notifications-endpoints.ts';
export * from './pve/cluster-notifications.ts';
export * from './pve/cluster-options.ts';
export * from './pve/cluster-qemu-custom-cpu-models.ts';
export * from './pve/cluster-qemu-custom-cpu-models-cputype.ts';
export * from './pve/cluster-replication.ts';
export * from './pve/cluster-sdn.ts';
export * from './pve/cluster-sdn-fabrics.ts';
export * from './pve/cluster-sdn-ipams.ts';
export * from './pve/cluster-sdn-vnets.ts';
export * from './pve/cluster-sdn-vnets-vnet.ts';
export * from './pve/cluster-sdn-zones.ts';
export * from './pve/nodes.ts';
export * from './pve/nodes-node-ceph.ts';
export * from './pve/nodes-node.ts';
export * from './pve/nodes-node-config.ts';
export * from './pve/nodes-node-disks.ts';
export * from './pve/nodes-node-firewall.ts';
export * from './pve/nodes-node-hardware.ts';
export * from './pve/nodes-node-lxc-vmid.ts';
export * from './pve/nodes-node-lxc-vmid-firewall.ts';
export * from './pve/nodes-node-lxc-vmid-move-volume.ts';
export * from './pve/nodes-node-lxc-vmid-mtunnel.ts';
export * from './pve/nodes-node-lxc-vmid-resize.ts';
export * from './pve/nodes-node-lxc-vmid-rrd.ts';
export * from './pve/nodes-node-network.ts';
export * from './pve/nodes-node-qemu.ts';
export * from './pve/nodes-node-qemu-vmid.ts';
export * from './pve/nodes-node-qemu-vmid-config.ts';
export * from './pve/nodes-node-qemu-vmid-dbus-vmstate.ts';
export * from './pve/nodes-node-qemu-vmid-firewall-rules.ts';
export * from './pve/nodes-node-qemu-vmid-move-disk.ts';
export * from './pve/nodes-node-qemu-vmid-mtunnel.ts';
export * from './pve/nodes-node-qemu-vmid-status.ts';
export * from './pve/nodes-node-replication.ts';
export * from './pve/nodes-node-services.ts';
export * from './pve/nodes-node-storage.ts';
export * from './pve/nodes-node-storage-storage.ts';
export * from './pve/nodes-node-subscription.ts';
export * from './pve/nodes-node-vzdump.ts';
export * from './pve/pools.ts';
export * from './pve/storage.ts';
export * from './pve/version.ts';
