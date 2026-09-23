/**
 * The node-scoped PVE rows: Ceph, LXC, QEMU, node networking and ZFS — everything addressed under
 * `/nodes/{node}`, plus the one Ceph flag that lives on the cluster.
 *
 * ⚠️ THIS IS WHERE THE PATHS STOP BEING REGULAR. POST lands on the id for a Ceph daemon, on the
 *   collection for an OSD; a container is created and destroyed at one path but edited at another.
 *   Each row says which, and the test proves it against the schema.
 */
import { type Claim, type Ownership, P, createDestroy, crud } from './proxmox-ownership-shape.ts';

/** mds / mgr / mon: three separate paths, and POST is registered on the ID, not the collection. */
const CEPH_DAEMONS = [
  ['mds', '{name}'],
  ['mgr', '{id}'],
  ['mon', '{monid}'],
] as const;

export const PVE_NODE_OWNERSHIP: readonly Ownership[] = [
  {
    resource: 'Proxmox.CephDaemon',
    system: 'pve',
    file: `${P}/ceph-daemon.ts`,
    writes: CEPH_DAEMONS.flatMap(([kind, id]): readonly Claim[] =>
      createDestroy(`/nodes/{node}/ceph/${kind}/${id}`, `/nodes/{node}/ceph/${kind}/${id}`),
    ),
    refuted: [
      {
        method: 'DELETE',
        path: '/nodes/{node}/ceph/mds',
        why: 'The spec points `path` at the collection so the read works; ceph-daemon.ts overrides `delete` because DELETE is not registered there.',
      },
    ],
  },
  {
    resource: 'Proxmox.CephFlag',
    system: 'pve',
    file: `${P}/ceph-flag.ts`,
    writes: [{ method: 'PUT', path: '/cluster/ceph/flags/{flag}' }],
    refuted: [
      {
        method: 'POST',
        path: '/cluster/ceph/flags',
        why: 'PVE registers only PUT on the flags collection; ceph-flag.ts documents its create as unreachable.',
      },
    ],
  },
  {
    resource: 'Proxmox.CephFs',
    system: 'pve',
    file: `${P}/ceph-fs-wire.ts`,
    writes: createDestroy('/nodes/{node}/ceph/fs/{name}', '/nodes/{node}/ceph/fs/{name}'),
  },
  {
    resource: 'Proxmox.CephOsd',
    system: 'pve',
    file: `${P}/ceph-osd-write.ts`,
    writes: createDestroy('/nodes/{node}/ceph/osd', '/nodes/{node}/ceph/osd/{osdid}'),
  },
  {
    resource: 'Proxmox.CephPool',
    system: 'pve',
    file: `${P}/ceph-pool.ts`,
    writes: crud('/nodes/{node}/ceph/pool', '/nodes/{node}/ceph/pool/{name}'),
  },
  {
    // ⚠️ Four paths, not three: the guest is created and destroyed at one path, edited at
    //   `/config`, and grown at `/resize`. `resize` only ever grows a volume (lxc-volume.ts).
    resource: 'Proxmox.Lxc',
    system: 'pve',
    file: `${P}/lxc-lifecycle.ts`,
    writes: [
      { method: 'POST', path: '/nodes/{node}/lxc' },
      { method: 'PUT', path: '/nodes/{node}/lxc/{vmid}/config' },
      { method: 'PUT', path: '/nodes/{node}/lxc/{vmid}/resize' },
      { method: 'DELETE', path: '/nodes/{node}/lxc/{vmid}' },
    ],
  },
  {
    resource: 'Proxmox.NetworkApply',
    system: 'pve',
    file: `${P}/network-apply.ts`,
    writes: [{ method: 'PUT', path: '/nodes/{node}/network' }],
  },
  {
    resource: 'Proxmox.NodeNetwork',
    system: 'pve',
    file: `${P}/node-network.ts`,
    writes: crud('/nodes/{node}/network', '/nodes/{node}/network/{iface}'),
  },
  {
    resource: 'Proxmox.Vm',
    system: 'pve',
    file: `${P}/qemu.ts`,
    writes: [
      { method: 'POST', path: '/nodes/{node}/qemu' },
      { method: 'PUT', path: '/nodes/{node}/qemu/{vmid}/config' },
    ],
    /**
     * ⛔ MEASURED 2026-09-22 AGAINST pve-manager/9.2.4. `qemu.ts` points `path` at the CONFIG
     *   sub-resource so read and update work, and the shared factory's `destroy` DELETEs `path` —
     *   but PVE registers GET, POST and PUT there and no DELETE. Destroying a `Proxmox.Vm`
     *   therefore calls an endpoint that does not exist. `ceph-daemon.ts` hit the same shape and
     *   overrode `delete`; qemu.ts has not. NOT FIXED HERE ON PURPOSE: the fix points DELETE at
     *   `/nodes/{node}/qemu/{vmid}`, turning a call that fails into one that really destroys a VM,
     *   and that belongs in its own reviewed change.
     */
    broken: [
      {
        method: 'DELETE',
        path: '/nodes/{node}/qemu/{vmid}/config',
        why: 'PVE has no DELETE on the config sub-resource; a VM is destroyed at /nodes/{node}/qemu/{vmid}.',
      },
    ],
  },
  {
    resource: 'Proxmox.ZfsPool',
    system: 'pve',
    file: `${P}/zfs-pool.ts`,
    writes: createDestroy('/nodes/{node}/disks/zfs', '/nodes/{node}/disks/zfs/{name}'),
  },
];
