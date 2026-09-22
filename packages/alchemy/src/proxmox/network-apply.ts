/**
 * `Proxmox.NetworkApply` — the call that makes a declared interfaces file real, ON ONE NODE.
 *
 * ⛔ WITHOUT IT EVERY NETWORK DECLARATION IS A GREEN PLAN THAT CHANGES NO NETWORK; WITH IT A GREEN
 *   PLAN CAN TAKE A NODE OFF THE NETWORK. Writes under `nodes/{node}/network/{iface}` edit
 *   `/etc/network/interfaces.new` and touch no interface. `PUT /nodes/{node}/network` is the apply.
 *   MEASURED in the cluster's own source on node-b, 2026-09-13 — `PVE/API2/Network.pm`:
 *       rename($new_config_file, $current_config_file) if -e $new_config_file;
 *       PVE::Tools::run_command(['ifreload', '-a'], errfunc => $err);
 *       return $rpcenv->fork_worker('srvreload', 'networking', $authuser, $worker);
 *
 * ⛔ THIS IS THE MOST DANGEROUS RESOURCE IN THE PACKAGE, AND ON C1 THE DANGER IS NOT ABSTRACT.
 *   Ceph runs over `vmbr1.42` on node-b, node-c AND node-d (MEASURED 2026-09-13: four pools, size 3 /
 *   min_size 2, mon+mgr+mds on all three). `ifreload -a` takes that node's OSDs, mons and MDS off
 *   the cluster network for the length of the reload; two nodes at once puts every pool below
 *   min_size and blocks IO for every guest with an RBD disk. The management address the API is
 *   reached on, `vmbr0.41`, is reloaded by the same call.
 *
 * ⛔ AND UNLIKE `SdnApply` IT IS PER NODE, SO A HALF-RECONFIGURED CLUSTER IS THE DEFAULT FAILURE
 *   MODE, NOT AN EDGE CASE. `PUT /cluster/sdn` publishes the whole cluster in one call; this
 *   publishes exactly one node, so a stack holding three of these can apply node-b, fail, and leave node-c
 *   and node-d on the old layout with Ceph spanning all three. Four things here exist only for that:
 *     1. `after` SERIALISES THEM — chain node-c after node-b and node-d after node-c, so at most one node is ever
 *        mid-reload. Three declared in parallel is the outage, and nothing in Alchemy stops you.
 *     2. `reconcile` REFUSES TO START on a cluster that is already degraded.
 *     3. `reconcile` RE-CHECKS quorum and every member's `online` flag AFTER the reload and dies if
 *        the cluster came back worse — which stops the chain before it reaches the second node.
 *     4. NOTHING IS EVER APPLIED WITH NOTHING STAGED. See the first branch of `apply`.
 *
 * ⚠️ IF THE MEMBER SERVING THE POLL IS THE NODE BEING RELOADED, the reload can drop the connection
 *   carrying its own status poll — see network-apply-read.ts. Every endpoint is `proxyto =>
 *   'node'`, so any cluster member can serve any other node's paths; failover in client.ts picks
 *   whichever member is up, not necessarily one you are not applying.
 *
 * ⚠️ `DELETE /nodes/{node}/network` IS THE REVERT, AND IT IS DELIBERATELY NOT WIRED TO `delete`.
 *   MEASURED: the whole body of `revert_network_changes` is `unlink "/etc/network/interfaces.new"`.
 *   It discards STAGED edits and cannot undo an APPLIED one, so pointing `delete` at it would throw
 *   away whatever happened to be staged the moment somebody removed a line from a stack file — the
 *   worst possible time to do it. Revert by hand, deliberately: `pvesh delete /nodes/<node>/network`.
 *
 * ⚠️ PRIVILEGES, so widening stays a deliberate act: the `read` role needs nothing for the pending
 *   read (`GET /nodes/{node}/network` is `"user": "all"`) and `Sys.Audit` on `/` for the health
 *   gate; the `provision` role needs `Sys.Modify` on `/nodes/{node}` for the apply, and owns the
 *   task it starts so it can poll it without `Sys.Audit`. ⛔ `Sys.Modify` ON A NODE IS NOT A SMALL
 *   GRANT — it also carries that node's DNS, hosts file, time and service configuration. Granting
 *   it cluster-wide to run this resource widens the provisioning role well beyond networking.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { guardNetworkApply } from './apply-endpoints.ts';
import { pveWith } from './client.ts';
import { mint } from './credentials.ts';
import { awaitTask, degradedReason, pendingCount } from './network-apply-read.ts';
import type { PveRequirements } from './resource.ts';
import type { WithTarget } from './resource.ts';

export interface NetworkApplyProps extends WithTarget {
  /**
   * The node whose staged interfaces file this applies — `node-b`.
   *
   * ⚠️ ONE APPLY PER NODE, AND NEVER TWO FOR THE SAME NODE. Two would each publish the other's
   *   staged half, and both would run `ifreload` on a file the other had not finished writing.
   */
  node: string;

  /**
   * The staged interface changes this apply publishes, and the apply that must go before it.
   *
   * ⚠️ IT IS NEVER READ, AND IT IS NOT DECORATION — the same contract as `SdnApply.after`. Alchemy
   *   orders resources by DATA FLOW, so consuming an attribute is the only way to say "after".
   *   Pass the interfaces this node declares AND the previous node's apply:
   *   `after: [vmbr1.iface, n2Apply.pending]`. Leave the previous apply out and the three nodes
   *   reload in parallel, which is the one thing this resource is built to prevent.
   */
  after?: readonly unknown[];
}

export interface NetworkApplyAttributes {
  /** The node this applies. Identity, echoed so a plan line says which member it will reload. */
  node: string;

  /**
   * Changed lines still staged on this node.
   *
   * ⚠️ LINES OF A UNIFIED DIFF, NOT INTERFACES, and the number is reported rather than trusted —
   *   `pendingLines` explains why it can undercount by one and never to zero. Zero is the only
   *   settled value: anything above it means the running config and the staged config disagree,
   *   whether this stack staged it or somebody edited the node in the UI and walked away.
   *
   * ⛔ THE DIFF ITSELF IS NEVER AN ATTRIBUTE. Alchemy writes attributes to its state store
   *   UNENCRYPTED, and `/etc/network/interfaces` can carry a `wpa-psk` or a `pre-up` command. Only
   *   the count leaves `network-apply-read.ts`.
   *
   * ⚠️ AND NOTHING OUT OF THE INTERFACE ROWS IS AN ATTRIBUTE EITHER, WHICH IS WHAT KEEPS THIS
   *   FAMILY NOOP. `GET /nodes/{node}/network` returns eighteen fields it will not accept on write
   *   — MEASURED by differencing the schema's GET return properties against its POST parameters:
   *   `active`, `exists`, `families`, `method`, `method6`, `options`, `priority`, `link-type` and
   *   ten more; `altnames` is returned and is not even in the schema. `priority` is the worst of
   *   them: PVE ASSIGNS it from the order of the interfaces file, so the same logical layout
   *   carries different numbers on different nodes (MEASURED: node-d's differ from node-b/node-c's by one).
   *   Every one of those is a forever-diff waiting for whoever writes `Proxmox.NetworkInterface`.
   *   This resource compares a single integer against zero and never looks at a row at all.
   */
  pending: number;
}

export interface ProxmoxNetworkApply extends Resource<
  'Proxmox.NetworkApply',
  NetworkApplyProps,
  NetworkApplyAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxNetworkApply = Resource<ProxmoxNetworkApply>('Proxmox.NetworkApply');

const read = (props: NetworkApplyProps) =>
  pendingCount(props.target, props.node).pipe(
    Effect.map((pending) => ({ node: props.node, pending })),
  );

/**
 * ⚠️ THE DIFF IS ABOUT THE NODE, NOT ABOUT THE PROPS — the same reasoning as `SdnApply`. This
 *   resource has no settable field (`node` is identity, `after` is an ordering edge), so comparing
 *   props to props would report `noop` forever and the apply would run exactly once, ever. What
 *   decides it is whether the node is carrying a staged change right now.
 *
 * ★ THIS IS ALSO WHY DECLARING THE LIVE CLUSTER PLANS AS `noop`. VERIFIED 2026-09-13:
 *   `/etc/network/interfaces.new` is absent on node-b, node-c and node-d, so `changes` is absent from all three
 *   answers, so `pending` is 0 on all three and every one of them plans `noop`.
 */
const diff = (news: Input<NetworkApplyProps>) =>
  Effect.gen(function* () {
    if (!isResolved(news)) return undefined;
    const { pending } = yield* read(news);
    return pending === 0 ? ({ action: 'noop' } as const) : ({ action: 'update' } as const);
  });

/** Stop the deploy, loudly, with the node in the message. ⚠️ A die here is the SAFE outcome. */
const refuse = (node: string, why: string) =>
  Effect.die(new Error(`Proxmox.NetworkApply ${node}: ${why}`));

const apply = (props: NetworkApplyProps) =>
  Effect.gen(function* () {
    const node = props.node;
    const staged = yield* pendingCount(props.target, node);
    /**
     * ⛔ NOTHING STAGED MEANS NOTHING TO APPLY, AND THIS BRANCH IS A SAFETY PROPERTY RATHER THAN AN
     *   OPTIMISATION. `reconcile` also runs on CREATE — the first time this resource appears in a
     *   stack, before `diff` has ever been consulted — and the PVE worker runs `ifreload -a`
     *   UNCONDITIONALLY, staged file or not. Without this branch, adding `Proxmox.NetworkApply` to
     *   a stack describing the cluster as it already is would reload networking on every node it
     *   names, for nothing. Adoption must cost nothing; that is true here in the strongest sense.
     */
    if (staged === 0) return { node, pending: 0 };

    const before = yield* degradedReason(props.target);
    if (before !== undefined) {
      return yield* refuse(
        node,
        `refusing to reload networking on a cluster that is already degraded (${before}). ` +
          'Ceph spans these nodes -- fix the cluster first, then re-run the deploy.',
      );
    }

    /**
     * ⚠️ ONE LEASE FOR BOTH CALLS, VIA `pveWith` RATHER THAN `pve`. Each mint returns a NEW token
     *   id, and the task-status endpoint only skips its `Sys.Audit` check for the task's OWNER —
     *   so polling with a fresh mint is a different identity and needs a privilege this role does
     *   not have. The `provision` lease is 300s and non-renewable, which is far longer than a
     *   reload and is the reason no renew path is reached for.
     */
    // ⛔ BEFORE THE MINT AND THE RELOAD. The apply takes no body, so this is the lookup rather
    //   than a value check: a vendor that moved this endpoint fails here, not mid-ifreload.
    yield* guardNetworkApply;
    const credential = yield* mint(props.target, 'provision');
    const upid = yield* pveWith<string>(props.target, credential, 'PUT', `nodes/${node}/network`);
    if (upid === undefined) {
      return yield* refuse(
        node,
        'the apply returned no UPID. PVE wraps every answer in {"data":...} and can report success ' +
          'on a call that did nothing -- the reload cannot be confirmed, so it is not claimed.',
      );
    }

    /**
     * ⛔ POLLING `pending` INSTEAD OF THE TASK WOULD REPORT SUCCESS BEFORE THE NETWORK WAS TOUCHED.
     *   MEASURED in the worker above: the `rename` happens FIRST and `ifreload -a` second, so the
     *   staged file — and therefore `changes`, and therefore `pending` — disappears while the
     *   reload has not yet started. A provider that watched the count would call a reload that had
     *   not run, and a reload that then FAILED, a success. The task's exitstatus is the only
     *   honest answer.
     */
    const exitstatus = yield* awaitTask(props.target, credential, node, upid);
    if (exitstatus !== 'OK') {
      return yield* refuse(
        node,
        `the reload ended "${exitstatus}" (${upid}). Read it from ANOTHER node -- ` +
          `\`pvesh get /nodes/${node}/tasks/${upid}/log\` -- and do not apply the next node until ` +
          'this one is understood.',
      );
    }

    const after = yield* degradedReason(props.target);
    if (after !== undefined) {
      return yield* refuse(
        node,
        `the reload reported OK but the cluster is now degraded (${after}). The next ` +
          'node has NOT been applied. Restore this one before continuing -- Ceph runs over these ' +
          'links and a second reload now would take pools below min_size.',
      );
    }

    const left = yield* pendingCount(props.target, node);
    if (left !== 0) {
      return yield* refuse(
        node,
        `the reload reported OK but ${String(left)} staged line(s) remain. The running config does ` +
          'not match the declared one, and saying otherwise is the lie this resource exists to stop.',
      );
    }
    return { node, pending: left };
  });

/**
 * ⛔ HAND-WRITTEN RATHER THAN `pveHandlers`, FOR THE SAME REASON `sdn-apply.ts` IS. The factory's
 *   spec is create/update/delete over ONE object at ONE path, and an apply is not an object: there
 *   is nothing to POST, nothing to DELETE, and `matches` would compare a declaration to itself and
 *   answer `noop` forever, so the apply would run exactly once in the life of the stack. `list` is
 *   empty for the reason it is everywhere in this package — adoption stays an explicit act.
 *
 * ⛔ `delete` APPLIES NOTHING AND UNDOES NOTHING, AND THAT IS CORRECT. There is no un-apply: the
 *   config is already live on the node, and the way to remove an interface is to delete it and
 *   apply AGAIN. See the ⚠️ about `DELETE /nodes/{node}/network` at the top of this file.
 */
const handlers = {
  delete: () => Effect.void,
  diff: ({ news }: { news: Input<NetworkApplyProps> }) => diff(news),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: NetworkApplyProps }) => read(olds),
  reconcile: ({ news }: { news: NetworkApplyProps }) => apply(news),
};

export const ProxmoxNetworkApplyProvider = () =>
  Provider.effect(ProxmoxNetworkApply, Effect.succeed(ProxmoxNetworkApply.Provider.of(handlers)));
