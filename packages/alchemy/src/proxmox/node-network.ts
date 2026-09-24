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
 *   (2026-09-24, decision 43). Dual-path read and `read`'s `output`-branching wired like every
 *   other migrated family; node-network-wire.ts's `readInterfaceOrFail` has the new nuance.
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
  type NodeNetworkProps,
  createForm,
  updateForm,
} from './node-network-form.ts';
import {
  dropUnreadable,
  matches,
  readInterface,
  readInterfaceOrFail,
} from './node-network-wire.ts';
import type { NodeNetworkAttributes } from './node-network-wire.ts';
import { runPve } from './distilled-pve.ts';
import { type PveRequirements } from './resource-spec.ts';
import { UNREADABLE, unreadableWarning } from './unreadable-read.ts';

export type { NodeNetworkAttributes, NodeNetworkType } from './node-network-wire.ts';
// ⚠️ MOVED TO node-network-form.ts IN THIS PR'S LINE-CAP TRIM — every field on it is already
//   documented there against `body`/`createForm`/`updateForm`, so it travels with them rather
//   than duplicating that documentation here. Nothing about its shape changed.
export type { NodeNetworkProps } from './node-network-form.ts';

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

/**
 * The three fields distilled's generator renamed to an underscore (`bond-primary`, `vlan-id`,
 * `vlan-raw-device`) — everything else round-trips as-is. `storage-form.ts`'s `underscored` is a
 * generic transform for a free-form bag; this family's fields are all named ahead of time, so a
 * small local map is clearer than importing a generic helper for three keys. Moved here from
 * node-network-form.ts in this PR's line-cap trim — this is the only caller.
 */
const RENAMED: Readonly<Record<string, string>> = {
  'bond-primary': 'bond_primary',
  'vlan-id': 'vlan_id',
  'vlan-raw-device': 'vlan_raw_device',
};

const toDistilled = (form: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(form).map(([key, value]) => [RENAMED[key] ?? key, value]));

/** The actual `createNodeNetwork` call body — `createForm`, translated once. See `toDistilled`. */
const toDistilledCreate = (props: NodeNetworkProps): nodes.CreateNodeNetworkRequest =>
  ({
    ...toDistilled(createForm(props)),
    node: props.node,
  }) as unknown as nodes.CreateNodeNetworkRequest;

/** The actual `putNodeNetwork2` call body — `updateForm`, translated once. See `toDistilledCreate`. */
const toDistilledUpdate = (props: NodeNetworkProps): nodes.PutNodeNetwork2Request =>
  ({
    ...toDistilled(updateForm(props)),
    iface: props.iface,
    node: props.node,
  }) as unknown as nodes.PutNodeNetwork2Request;

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
        // ⚠️ FOLDS ONLY WHEN `output` IS `undefined`, restored by adversarial review after a
        //   first draft dropped it — node-network-wire.ts's `readInterface` has the reasoning.
        read: Effect.fn(function* ({ olds, output }) {
          return dropUnreadable(
            yield* output === undefined ? readInterface(olds) : readInterfaceOrFail(olds),
          );
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(NODE_NETWORK_CREATE, createForm(news), output === undefined);
          yield* guardWrite(NODE_NETWORK_UPDATE, updateForm(news), false);
          if (output === undefined) return undefined;
          const live = yield* readInterfaceOrFail(news);
          // ⛔ THE CRIES-WOLF FIX: a refused mint used to fall into `undefined` and force `update`
          //   on an interface that was plainly there — see unreadable-read.ts.
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.NodeNetwork', `${news.node}/${news.iface}`);
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
                `nodes/${news.node}/network/${news.iface}: wrote with no error, but the ` +
                  'interface is still absent -- PVE wraps every answer in {"data":...} and can ' +
                  'report success on a call that did nothing, so read back rather than trust it.',
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
