/**
 * `Proxmox.SdnApply` — the call that makes a declared network real.
 *
 * ⛔ WITHOUT THIS RESOURCE, EVERY SDN DEPLOY IS A GREEN PLAN THAT CHANGES NO NETWORK. Writes under
 *   `cluster/sdn/*` edit files in `/etc/pve/sdn/` and touch nothing on any node. `PUT /cluster/sdn`
 *   is the apply, and it is CLUSTER-WIDE — it publishes every staged object at once, not the one
 *   that happened to reconcile.
 *
 * ★ MEASURED ON C1 ON 2026-09-13, NOT INFERRED. A probe zone was created, inspected and removed:
 *
 *     pvesh create /cluster/sdn/zones --zone zzprobe --type simple
 *     GET /cluster/sdn/zones/zzprobe              -> {"digest":"c438…","type":"simple","zone":"zzprobe"}
 *     GET /cluster/sdn/zones/zzprobe?pending=1    -> {"digest":null,"pending":{},"state":"new",…}
 *     GET /cluster/sdn/zones?running=1            -> []            ⬅ THE APPLIED CONFIG WAS EMPTY
 *
 *   So the plain read — the one `pveOperations` performs — answers from the STAGED file and cannot
 *   tell staged from applied. `state` appears only under `?pending=1`, and `?running=1` is the
 *   applied view. That is the whole basis for this resource.
 *
 * ★ IT IS A RESOURCE RATHER THAN A HOOK SO THAT THE GRAPH ORDERS IT. Pass the zones and vnets it
 *   should follow in `after`; Alchemy orders by data flow, so reading their attributes is what
 *   puts the apply last. A stack-level hook would fire on every run, including runs where no SDN
 *   object changed, and would be invisible in `plan`.
 *
 * ⚠️ ONE APPLY PER STACK. Two of these would each publish the other's staged half, so whichever
 *   ran first would apply a zone its own declaration had not finished writing. Declare one.
 *
 * ⚠️ THE COLLECTION READ IS DELIBERATE, AND IT IS WHAT LETS THE READ LEASE SEE ANYTHING AT ALL.
 *   `GET /cluster/sdn/zones/{zone}` is checked against SDN.Allocate — read the ⛔ in sdn-zone.ts —
 *   but `GET /cluster/sdn/zones` is "list entries where you have SDN.Audit or SDN.Allocate", so
 *   the collection answers an auditor-shaped credential. This resource only ever reads collections.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { pve } from './client.ts';
import type { PveRequirements } from './resource.ts';
import type { WithTarget } from './resource.ts';
import { sdnPendingCount } from './sdn-apply-read.ts';

export interface SdnApplyProps extends WithTarget {
  /**
   * The staged objects this apply publishes.
   *
   * ⚠️ IT IS NEVER READ, AND IT IS NOT DECORATION. Alchemy orders resources by DATA FLOW, so the
   *   only way to say "after the zones" is to consume something the zones produced. Pass their
   *   attributes here — `after: [zone.zone, vnet.vnet]` — and the apply lands last. Leave it out
   *   and the apply may run BEFORE the zone it was meant to publish, which plans green and
   *   changes nothing.
   */
  after?: readonly unknown[];
}

export interface SdnApplyAttributes {
  /**
   * How many SDN objects are still staged.
   *
   * ⚠️ ZERO IS THE ONLY SETTLED VALUE. Anything above it means the running config and the staged
   *   config disagree — which is drift whether this stack caused it or somebody staged a zone in
   *   the UI and walked away.
   */
  pending: number;
}

export interface ProxmoxSdnApply extends Resource<
  'Proxmox.SdnApply',
  SdnApplyProps,
  SdnApplyAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxSdnApply = Resource<ProxmoxSdnApply>('Proxmox.SdnApply');

const read = (props: SdnApplyProps) =>
  sdnPendingCount(props.target).pipe(Effect.map((pending) => ({ pending })));

export const ProxmoxSdnApplyProvider = () =>
  Provider.effect(
    ProxmoxSdnApply,
    Effect.succeed(
      ProxmoxSdnApply.Provider.of({
        /** ⛔ Empty for the same reason as every other resource here: adoption must be explicit. */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          return yield* read(olds);
        }),

        /**
         * ⚠️ THE DIFF IS ABOUT THE CLUSTER, NOT ABOUT THE PROPS. This resource has no settable
         *   field — `after` exists only to create an ordering edge — so comparing props to props
         *   would report `noop` forever and the apply would run exactly once, ever. What decides
         *   it is whether anything is staged right now.
         */
        diff: Effect.fn(function* ({ news }: { news: Input<SdnApplyProps> }) {
          if (!isResolved(news)) return undefined;
          const { pending } = yield* read(news);
          return pending === 0 ? ({ action: 'noop' } as const) : ({ action: 'update' } as const);
        }),

        reconcile: Effect.fn(function* ({ news }) {
          /**
           * ⛔ NOTHING STAGED MEANS NOTHING TO PUBLISH, AND THIS BRANCH IS A SAFETY PROPERTY RATHER
           *   THAN AN OPTIMISATION — the same one network-apply.ts has carried all along, and the
           *   absence of which is why this resource could not be declared at all.
           *
           * 🔴 WHAT IT PREVENTS. `reconcile` runs on CREATE, the first time this resource appears
           *   in a stack, before `diff` has ever been consulted. `PUT /cluster/sdn` regenerates
           *   `/etc/network/interfaces.d/sdn` on EVERY node at once — and on C1 that file carries
           *   the OSPF fabric holding Ceph's `cluster_network` on tb0/tb1. Without this branch,
           *   adding one line to a stack file reloads networking on all three nodes simultaneously,
           *   which is precisely what the serialised NetworkApply chain exists to prevent.
           *
           * ⚠️ IT DEPENDS ON sdn-apply-read.ts BEING HONEST ABOUT THE WHOLE SURFACE. A count that
           *   only looks at zones and vnets answers zero on a cluster with a staged fabric, and
           *   this branch would then wave through the exact publish it is here to stop.
           */
          const staged = yield* read(news);
          if (staged.pending === 0) return staged;

          yield* pve(news.target, 'provision', 'PUT', 'cluster/sdn');
          /**
           * ⛔ READ BACK, FOR THE SAME REASON THE FACTORY DOES. PVE answers 200 on writes that did
           *   nothing, and here "nothing" is indistinguishable from success by status code alone.
           *   If objects are still staged after an apply, the network does NOT match the
           *   declaration and saying otherwise is the exact lie this resource was added to stop.
           */
          const after = yield* read(news);
          if (after.pending !== 0) {
            return yield* Effect.die(
              new Error(
                `PUT /cluster/sdn returned no error but ${String(after.pending)} SDN object(s) ` +
                  'are still staged. The running config does not match the declared one -- check ' +
                  '`pvesh get /cluster/sdn/zones --pending 1` for the objects PVE refused.',
              ),
            );
          }
          return after;
        }),

        /**
         * ⛔ DELETING THIS RESOURCE APPLIES NOTHING AND UNDOES NOTHING, AND THAT IS CORRECT. There
         *   is no un-apply in PVE: the running config is already published on every node, and the
         *   way to remove a network is to delete the zone or vnet and apply AGAIN. Making this
         *   destroy call `PUT /cluster/sdn` would publish whatever happened to be staged at the
         *   moment somebody removed a line from a stack file, which is the worst possible time.
         */
        delete: () => Effect.void,
      }),
    ),
  );
