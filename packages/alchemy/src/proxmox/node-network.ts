/**
 * `Proxmox.NodeNetwork` — one stanza of a node's `/etc/network/interfaces`, declared.
 *
 * ⛔ DECLARING THIS RESOURCE IS SAFE. APPLYING IT IS A SEPARATE, DELIBERATE ACT, AND IT IS NOT
 *   PERFORMED HERE. Every write under `/nodes/{node}/network/{iface}` lands in
 *   `/etc/network/interfaces.new` and changes no running interface. MEASURED, from PVE::INotify:
 *   `$shadowfiles = { '/etc/network/interfaces' => '/etc/network/interfaces.new' }`, and
 *   `read_file` reads the SHADOW when it exists. The apply is `PUT /nodes/{node}/network`, which
 *   renames the shadow over the real file and runs `ifreload -a`; the revert is
 *   `DELETE /nodes/{node}/network`, which simply unlinks the shadow. A sibling resource models
 *   that apply — this one never calls it, exactly as `Proxmox.SdnZone` never calls
 *   `Proxmox.SdnApply`.
 *
 * ⛔ `Proxmox.NetworkApply` STAYS ON `client.ts`, NOT MIGRATED WITH THIS FILE — network-apply-
 *   read.ts's own header has the two MEASURED reasons distilled cannot represent yet.
 *
 * ⛔ CEPH ON C1 RIDES TWO NETWORKS AND THIS API ONLY SEES ONE OF THEM. Measured from
 *   `/etc/pve/ceph.conf` on 2026-09-13:
 *
 *     public_network  = 198.51.100.0/24     -> vmbr1.42, which this resource DOES see
 *     cluster_network = 203.0.113.0/24     -> every OSD's cluster_addr: .102 / .103 / .104
 *
 *   The cluster network — OSD REPLICATION, the traffic that rebuilds a lost replica — lives on
 *   `203.0.113.10X/32` addresses carried by `tb0`, `tb1` and `dummy_c1`: the Thunderbolt mesh —
 *   TB4's own fabric ports, EXCLUDED from this family by decision 28/29/9 (SdnFabric owns them).
 *
 * ⛔ AND THOSE ADDRESSES ARE INVISIBLE HERE, WHICH IS THE TRAP. They are declared in
 *   `/etc/network/interfaces.d/sdn`, and PVE's network API does not parse that directory.
 *   MEASURED: `GET /nodes/node-b/network/tb0` answers `{"method":"manual","type":"eth",…}` with NO
 *   address, while `ip -br -4 addr` shows `tb0  UP  203.0.113.102/32`. So this resource reports
 *   tb0 and tb1 as address-less manual ports and will plan `noop` over them — implicitly
 *   asserting they carry no address, which is FALSE.
 *
 *   The consequence, stated plainly: declaring tb0/tb1 from what this API reports and then
 *   DESTROYING or applying over them takes out OSD replication on a cluster whose pools are
 *   size 3 / min_size 2. They read as the most boring interfaces on the node and are the two most
 *   dangerous. Leave them undeclared; if they must be managed, manage the file that actually
 *   owns them, not this resource.
 *
 * ⚠️ Two ways this file limits the damage on the interfaces it CAN see: `cidr` is compared
 *   unconditionally (node-network-wire.ts's own ⛔ on `matches`), and a live interface whose
 *   `type` disagrees with the declaration is reported ABSENT rather than retyped
 *   (node-network-wire.ts's `attributesOf`).
 *
 * ★ THE REASON IT EXISTS IS THAT THE STAGED READ CANNOT TELL YOU THE NETWORK IS RIGHT — it can
 *   only tell you the FILE is. Once anything is staged, `GET /nodes/{node}/network/{iface}`
 *   answers from `interfaces.new`, so `matches` compares a declaration against a pending file and
 *   reports `noop` over a node whose running config has not moved. The apply resource is what
 *   closes that gap; this resource's `noop` means "the file says what you said", no more.
 *
 * ⚠️ PRIVILEGES ARE COARSER HERE THAN ANYWHERE ELSE IN THE PACKAGE: reads want `Sys.Audit` on
 *   `/nodes/{node}`, every write `Sys.Modify` on it — and there is no `/nodes/{node}/network` ACL
 *   object to scope to, so that also buys the node's services, certificates, DNS and time.
 *   Collected with every other family in docs/privileges.md.
 *
 * ★ A RECONCILE OVER A MATCHING INTERFACE IS A NO-WRITE. `reconcile` below gates the PUT on
 *   `matches` first — adopting an interface a node already has must not leave it holding a
 *   pending network change, since a PUT under `/nodes/{node}/network/{iface}` STAGES one.
 *
 * ⚠️ WHAT IS STILL TRUE: when `matches` is false the PUT rewrites the whole stanza, and that can
 *   ADD lines the file did not have — a `vlan-raw-device vmbr1` under `vmbr1.42`, where PVE had
 *   been deriving it from the name. Harmless in content, and it costs nothing until somebody
 *   applies; one more reason the apply is a separate resource.
 *
 * ⚠️ `list` IS EMPTY, AND HERE THAT MATTERS MORE THAN ANYWHERE ELSE IN THIS PACKAGE. The index
 *   returns every interface the node has, `vmbr0`, `bond0` and the Ceph vlan included. Adopting
 *   them would put Alchemy one `destroy` away from staging the removal of a node's uplink — and
 *   `delete_network` has NO in-use check at all: MEASURED, it deletes the hash entry and writes
 *   the file. Adoption stays explicit.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()`/`pveHandlers` ONTO `@distilled.cloud/proxmox`'s
 *   typed `nodes.getNodeNetwork`/`createNodeNetwork`/`putNodeNetwork2`/`deleteNodeNetwork2`
 *   (2026-09-24, decision 43's proxmox walk-down, nodes/storage sub-area). `distilled-pve.ts`'s
 *   `runPve` replaces `pve()`. No dual-path read here, unlike user.ts/group.ts/storage.ts/
 *   zfs-pool.ts — see node-network-wire.ts's `readInterface` for why one function is enough.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { guardWrite } from './distilled-guard.ts';
import {
  NODE_NETWORK_CREATE,
  NODE_NETWORK_UPDATE,
  createForm,
  toDistilledCreate,
  toDistilledUpdate,
  updateForm,
} from './node-network-form.ts';
import { dropUnreadable, matches, readInterface } from './node-network-wire.ts';
import type { NodeNetworkAttributes, NodeNetworkType } from './node-network-wire.ts';
import { runPve } from './distilled-pve.ts';
import { type PveRequirements, type WithTarget } from './resource-spec.ts';
import { UNREADABLE } from './unreadable-read.ts';

export type { NodeNetworkAttributes, NodeNetworkType } from './node-network-wire.ts';

export interface NodeNetworkProps extends WithTarget {
  /** Which node's file this stanza lives in. Interfaces are per node, never cluster-wide. */
  node: string;
  /** `vmbr0`, `bond0`, `vmbr1.42`. 2-20 characters, PVE's `pve-iface` format. */
  iface: string;
  /** ⛔ REQUIRED ON EVERY WRITE, update included, never used to retype — see node-network-wire.ts. */
  type: NodeNetworkType;
  /**
   * `198.51.100.12/24`. ⛔ THE ONE FIELD WITH NO UNMANAGED MODE: leaving it out is an instruction
   * to make the interface `manual`, not an instruction to leave its address alone. The ⛔ on
   * `updateForm` in node-network-form.ts has the measurement and the consequence.
   */
  cidr?: string;
  /** ⚠️ PVE allows exactly ONE default gateway per node and refuses a second with "Default
   *  gateway already exists on interface '<other>'". On C1 it is vmbr0.41's. */
  gateway?: string;
  /**
   * `auto <iface>` in the file. Absent on read means off, which is why `bool`'s fallback is used.
   * ⚠️ UNDECLARED IS UNMANAGED ON AN UPDATE AND OFF ON A CREATE — the same asymmetry storage.ts
   *   has, and it bites harder here: an interface created without `autostart` is one the node
   *   will not bring up at boot. Every C1 bridge, bond and vlan carries it.
   */
  autostart?: boolean;
  /** 1280-65520. Unset leaves the file without an `mtu` line and the kernel default in force. */
  mtu?: number;
  /** ⚠️ Round-trips only after normalisation — see `comment` in node-network-wire.ts. */
  comments?: string;
  /** Space-separated, a SET: `enp87s0`, or `bond0`. ⚠️ PVE refuses a port already used elsewhere. */
  bridge_ports?: string;
  /** `2-4094`, or `2 100-200`. Only written when `bridge_vlan_aware` is on. */
  bridge_vids?: string;
  /** ⛔ A `false` here is sent as `delete=`, never as `0` — node-network-form.ts's ⛔ says why. */
  bridge_vlan_aware?: boolean;
  /**
   * A bond's members, space separated. ⚠️ THE PARAMETER IS `slaves`, NOT `bond_slaves`, in BOTH
   * directions on this PVE: MEASURED, the POST/PUT schema names only `slaves` and the GET returns
   * `"slaves":"enp2s0f0np0 enp2s0f1np1"`. `bond_slaves` appears nowhere in Network.pm here.
   */
  slaves?: string;
  bond_mode?: string;
  /** ⚠️ Only written when `bond_mode` is `balance-xor` or `802.3ad`; ignored otherwise. */
  bond_xmit_hash_policy?: string;
  /** active-backup only. Kept hyphenated because that is the wire name. */
  'bond-primary'?: string;
  /** ⚠️ DERIVED FROM A DOTTED NAME. `vmbr1.42` reports `vlan-id` 42 with no such line in the file;
   *  declaring it there is harmless but adds a line the file did not have. */
  'vlan-id'?: number;
  'vlan-raw-device'?: string;
}

export interface ProxmoxNodeNetwork extends Resource<
  'Proxmox.NodeNetwork',
  NodeNetworkProps,
  NodeNetworkAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a node's only uplink cannot be rebuilt. See the ★ in resource.ts. */
export const ProxmoxNodeNetwork = Resource<ProxmoxNodeNetwork>('Proxmox.NodeNetwork', {
  defaultRemovalPolicy: 'retain',
});

export const ProxmoxNodeNetworkProvider = () =>
  Provider.effect(
    ProxmoxNodeNetwork,
    Effect.succeed(
      ProxmoxNodeNetwork.Provider.of({
        /**
         * ⛔ EMPTY, AND HERE IT MATTERS MORE THAN ANYWHERE ELSE IN THIS PACKAGE. `GET
         *   /nodes/{node}/network` returns every interface the node has. Adoption stays explicit.
         */
        list: () => Effect.succeed([]),
        // ⚠️ ONE FUNCTION, EVERY CALLER — node-network-wire.ts's `readInterface` own header. This
        //   family's absence signal is a specific, PARSED typed error, not a generic fold, so the
        //   `output`-branching user.ts/group.ts/storage.ts/zfs-pool.ts need for the Drift.ts gap
        //   is unnecessary: a genuine transient failure already propagates for every caller.
        read: Effect.fn(function* ({ olds }) {
          return dropUnreadable(yield* readInterface(olds));
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(NODE_NETWORK_CREATE, createForm(news), output === undefined);
          yield* guardWrite(NODE_NETWORK_UPDATE, updateForm(news), false);
          if (output === undefined) return undefined;
          const live = yield* readInterface(news);
          // ⛔ THE CRIES-WOLF FIX: a refused `provision` mint used to fall into `undefined` below
          //   and force `update` on an interface that was plainly there — see unreadable-read.ts.
          //   This family reads with `read`, but the same sentinel handling applies uniformly.
          if (live === UNREADABLE) {
            return { action: 'noop' } as const;
          }
          if (live === undefined) {
            yield* guardWrite(NODE_NETWORK_CREATE, createForm(news), true);
            return { action: 'update' } as const;
          }
          return matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),
        /**
         * ⛔ THE DESTROY IS STAGED LIKE EVERY OTHER WRITE, WHICH MAKES IT THE ONE RECOVERABLE
         *   DESTROY IN THIS PACKAGE. It removes the stanza from `interfaces.new` and nothing
         *   else; `DELETE /nodes/{node}/network` (a DIFFERENT, collection-level endpoint —
         *   `Proxmox.NetworkApply`'s own revert, never called here) puts the node back by
         *   unlinking that file. It becomes irreversible the moment somebody applies — and PVE
         *   performs NO in-use check before removing an interface other bridges or Ceph still
         *   stand on.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const before = dropUnreadable(yield* readInterface(news));
          yield* guardWrite(NODE_NETWORK_CREATE, createForm(news), before === undefined);
          yield* guardWrite(NODE_NETWORK_UPDATE, updateForm(news), false);
          if (before === undefined) {
            yield* runPve(
              news.target,
              'provision',
              true,
              nodes.createNodeNetwork(toDistilledCreate(news)),
            );
          } else if (!matches(before, news)) {
            yield* runPve(
              news.target,
              'provision',
              true,
              nodes.putNodeNetwork2(toDistilledUpdate(news)),
            );
          }
          const after = dropUnreadable(yield* readInterface(news));
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `nodes/${news.node}/network/${news.iface}: the write returned no error but the ` +
                  'interface is still absent. PVE wraps every answer in {"data":...} and can ' +
                  'report success on a call that did nothing -- read back rather than trusting ' +
                  'the status code.',
              ),
            );
          }
          return after;
        }),
        delete: Effect.fn(function* ({ olds }) {
          yield* runPve(
            olds.target,
            'provision',
            true,
            nodes.deleteNodeNetwork2({ iface: olds.iface, node: olds.node }),
          );
        }),
      }),
    ),
  );
