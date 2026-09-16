/**
 * `Proxmox.Vm` — a QEMU virtual machine, declared.
 *
 * ⚠️ THE SAME FOUR OPERATIONS AS AN LXC OVER A DIFFERENT PATH, which is the point of the factory:
 *   `nodes/{node}/qemu` to create, `nodes/{node}/qemu/{vmid}/config` to read and update. A VM and a
 *   container differ in what they carry, not in how they are reconciled.
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
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { num } from './values.ts';

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

const shape = (props: VmProps) => ({
  cores: String(props.cores ?? 1),
  memory: String(props.memory ?? 512),
  name: props.name ?? `vm${String(props.vmid)}`,
  onboot: props.onboot === true ? '1' : '0',
  sockets: String(props.sockets ?? 1),
  ...(props.net0 === undefined ? {} : { net0: props.net0 }),
});

const handlers = pveHandlers<VmProps, VmAttributes>({
  attributes: (live, props) => ({
    cores: num(live['cores'], 1),
    memory: num(live['memory'], 512),
    name: typeof live['name'] === 'string' ? live['name'] : '',
    node: props.node,
    onboot: live['onboot'] === 1 || live['onboot'] === true,
    sockets: num(live['sockets'], 1),
    vmid: props.vmid,
  }),
  collection: (props) => `nodes/${props.node}/qemu`,
  createForm: (props) => ({ ...shape(props), vmid: String(props.vmid) }),
  matches: (attributes, props) =>
    attributes.name === (props.name ?? `vm${String(props.vmid)}`) &&
    attributes.memory === (props.memory ?? 512) &&
    attributes.cores === (props.cores ?? 1) &&
    attributes.sockets === (props.sockets ?? 1) &&
    attributes.onboot === (props.onboot === true),
  path: (props) => `nodes/${props.node}/qemu/${String(props.vmid)}/config`,
  updateForm: shape,
});

export const ProxmoxVmProvider = () =>
  Provider.effect(ProxmoxVm, Effect.succeed(ProxmoxVm.Provider.of(handlers)));
