/**
 * `Proxmox.Vm` — a QEMU virtual machine, declared. Exported (not just Provider-only) since
 * 2026-09-26 for Talos: see qemu-props.ts for what a declaration may say and why `cipassword`
 * and `machine` may never be one of them.
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
 * ⛔ THIS RESOURCE NEVER MIGRATES. `qemu-read.ts` refuses the plan outright when the declared vmid
 *   is found running on a DIFFERENT node than the one declared ("A migration is not an update") --
 *   unchanged by the 2026-09-26 export, and exactly what keeps a node-pinned Talos VM pinned.
 *
 * ⚠️ POWER STATE IS REPORTED, NEVER DECLARED. `status` is an attribute so a plan can show it; there
 *   is no `running` prop. Starting and stopping a VM from a plan would make a deploy a maintenance
 *   window, and the estate has one of those already.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { qemuHandlers } from './qemu-lifecycle.ts';
import type { PveRequirements } from './resource.ts';
import type { VmAttributes, VmProps } from './qemu-props.ts';

export type { VmAttributes, VmProps } from './qemu-props.ts';

export interface ProxmoxVm extends Resource<
  'Proxmox.Vm',
  VmProps,
  VmAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a VM's disks cannot be rebuilt from a line. See resource.ts / lxc.ts. */
export const ProxmoxVm = Resource<ProxmoxVm>('Proxmox.Vm', { defaultRemovalPolicy: 'retain' });

export { createForm } from './qemu-form.ts';

/**
 * ⛔ Destroy uses deleteNodeQemu (`DELETE /nodes/{node}/qemu/{vmid}`), not the config path.
 *   The old factory sent both reads and deletes to `.../config`.
 */
export const ProxmoxVmProvider = () =>
  Provider.effect(ProxmoxVm, Effect.succeed(ProxmoxVm.Provider.of(qemuHandlers)));
