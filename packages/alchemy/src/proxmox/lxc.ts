/**
 * `Proxmox.Lxc` — a container, declared. This is what the estate's provision credential exists for.
 *
 * ★ `hf-provision@pve` HOLDS EXACTLY THE ROLE THIS NEEDS, and nothing more: `LXCProvisioner` on `/`
 *   grants VM.Allocate, VM.Audit, VM.Config.{CPU,Disk,HWType,Memory,Network,Options},
 *   VM.PowerMgmt, Datastore.AllocateSpace, Datastore.Audit, SDN.Use, Sys.Audit. Read that list as a
 *   specification: the credential was scoped to provision containers and to do nothing else.
 *
 * ⛔ `vmid` IS THE PRIMARY KEY AND IT IS CLUSTER-WIDE, not per node. Two resources declaring the
 *   same vmid on different nodes are the same object, and PVE will refuse the second with
 *   "already exists". It is required rather than allocated here: letting the provider pick the next
 *   free id would make the identity of a container depend on the order plans happened to run in.
 *
 * ⚠️ MOST FIELDS ARE CREATE-TIME. `ostemplate` and `storage` are consumed when the rootfs is built
 *   and are not readable back afterwards, so they are deliberately NOT compared in `matches` --
 *   a provider that diffed them would report an update on every plan, forever. What is compared is
 *   what PVE will actually tell you about a running container.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { num } from './values.ts';

export interface LxcProps extends WithTarget {
  /** Which node hosts it. Moving a container between nodes is a migration, not an update. */
  node: string;
  /** ⛔ CLUSTER-WIDE primary key. Required, never auto-allocated — see the ⛔ above. */
  vmid: number;
  /** e.g. `local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst`. Create-time only. */
  ostemplate: string;
  /** Storage for the rootfs, e.g. `local-zfs`. Create-time only. */
  storage: string;
  hostname?: string;
  /** MiB. Mutable. */
  memory?: number;
  cores?: number;
  /** e.g. `name=eth0,bridge=vmbr0,ip=dhcp`. Mutable. */
  net0?: string;
  /** Start on boot. Mutable. */
  onboot?: boolean;
}

export interface LxcAttributes {
  vmid: number;
  node: string;
  hostname: string;
  memory: number;
  cores: number;
  onboot: boolean;
  /** `running` | `stopped`. Reported, never declared — power state is not configuration. */
  status: string;
}

export interface ProxmoxLxc extends Resource<
  'Proxmox.Lxc',
  LxcProps,
  LxcAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxLxc = Resource<ProxmoxLxc>('Proxmox.Lxc');

const handlers = pveHandlers<LxcProps, LxcAttributes>({
  /**
   * ⚠️ READ FROM `config`, NOT FROM THE GUEST LIST. `GET /nodes/{n}/lxc` reports runtime shape
   *   (status, uptime, current memory), while `/config` reports DECLARED shape. Diffing against
   *   runtime memory would report an update every time a container ballooned.
   */
  attributes: (live, props) => ({
    cores: num(live['cores'], 1),
    hostname: typeof live['hostname'] === 'string' ? live['hostname'] : '',
    memory: num(live['memory'], 512),
    node: props.node,
    onboot: live['onboot'] === 1 || live['onboot'] === true,
    status: typeof live['status'] === 'string' ? live['status'] : 'unknown',
    vmid: props.vmid,
  }),
  collection: (props) => `nodes/${props.node}/lxc`,
  createForm: (props) => ({
    cores: String(props.cores ?? 1),
    hostname: props.hostname ?? `ct${String(props.vmid)}`,
    memory: String(props.memory ?? 512),
    onboot: props.onboot === true ? '1' : '0',
    ostemplate: props.ostemplate,
    storage: props.storage,
    vmid: String(props.vmid),
    ...(props.net0 === undefined ? {} : { net0: props.net0 }),
  }),
  matches: (attributes, props) =>
    attributes.hostname === (props.hostname ?? `ct${String(props.vmid)}`) &&
    attributes.memory === (props.memory ?? 512) &&
    attributes.cores === (props.cores ?? 1) &&
    attributes.onboot === (props.onboot === true),
  path: (props) => `nodes/${props.node}/lxc/${String(props.vmid)}/config`,
  /**
   * ⚠️ PVE UPDATES A CONTAINER THROUGH `PUT .../config`, THE SAME PATH IT IS READ FROM, which is
   *   why `path` ends in `/config` while `collection` does not. Create POSTs to the collection;
   *   read and update both use the config document.
   */
  updateForm: (props) => ({
    cores: String(props.cores ?? 1),
    hostname: props.hostname ?? `ct${String(props.vmid)}`,
    memory: String(props.memory ?? 512),
    onboot: props.onboot === true ? '1' : '0',
    ...(props.net0 === undefined ? {} : { net0: props.net0 }),
  }),
});

/**
 * ⛔ PVE REFUSES TO DELETE A RUNNING CONTAINER, and that refusal is kept — `handlers.delete`
 *   passes it straight through. Stopping a guest so that a `destroy` can proceed is a decision an
 *   operator makes, not one a plan makes on their behalf while they are reading the diff.
 */
export const ProxmoxLxcProvider = () =>
  Provider.effect(ProxmoxLxc, Effect.succeed(ProxmoxLxc.Provider.of(handlers)));
