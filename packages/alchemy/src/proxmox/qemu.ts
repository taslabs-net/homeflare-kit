/**
 * `Proxmox.Vm` — a QEMU virtual machine, declared.
 *
 * ⚠️ CREATE is `POST /nodes/{node}/qemu`. GET and PUT stay on `.../qemu/{vmid}/config`.
 *   ⛔ DELETE is `DELETE /nodes/{node}/qemu/{vmid}` (`destroy_vm` in qemu-server Qemu.pm). The
 *   config route is not a destroy. A missing config file is `QemuConfigNotFound` only.
 *
 * ⛔ `vmid` IS CLUSTER-WIDE AND SHARED WITH CONTAINERS. A VM and an LXC cannot hold the same id, so
 *   these two resources compete for one number space. Declaring both with vmid 101 is not a
 *   collision Alchemy can see -- they are different resource types -- and PVE refuses the second
 *   with "already exists". Pick ids per cluster, not per kind.
 *
 * ⚠️ POWER STATE IS REPORTED, NEVER DECLARED. `status` is an attribute so a plan can show it; there
 *   is no `running` prop. Starting and stopping a VM from a plan would make a deploy a maintenance
 *   window, and the estate has one of those already.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { qemuHandlers } from './qemu-lifecycle.ts';
import type { PveRequirements, WithTarget } from './resource.ts';

export interface VmProps extends WithTarget {
  node: string;
  /** ⛔ Cluster-wide, and shared with LXC. See the ⛔ above. */
  vmid: number;
  name?: string;
  /** MiB. */
  memory?: number;
  cores?: number;
  sockets?: number;
  /** e.g. `virtio=<mac>,bridge=vmbr0`. */
  net0?: string;
  onboot?: boolean;
}

export interface VmAttributes {
  vmid: number;
  node: string;
  name: string;
  memory: number;
  cores: number;
  sockets: number;
  onboot: boolean;
}

export interface ProxmoxVm extends Resource<
  'Proxmox.Vm',
  VmProps,
  VmAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxVm = Resource<ProxmoxVm>('Proxmox.Vm');

export { createForm } from './qemu-form.ts';

/**
 * ⛔ Destroy uses deleteNodeQemu (`DELETE /nodes/{node}/qemu/{vmid}`), not the config path.
 *   The old factory sent both reads and deletes to `.../config`.
 */
export const ProxmoxVmProvider = () =>
  Provider.effect(ProxmoxVm, Effect.succeed(ProxmoxVm.Provider.of(qemuHandlers)));
