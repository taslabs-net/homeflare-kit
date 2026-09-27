/** The reload itself: one node, one lease, one task, then a health check. */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { guardNetworkApply } from './apply-endpoints.ts';
import { runPveWith } from './distilled-pve.ts';
import { mint } from './mint.ts';
import { awaitTask, degradedReason, pendingCount } from './network-apply-read.ts';
import type { NetworkApplyProps } from './network-apply.ts';
import { text } from './values.ts';

/** Stop the deploy, loudly, with the node in the message. ⚠️ A die here is the SAFE outcome. */
const refuse = (node: string, why: string) =>
  Effect.die(new Error(`Proxmox.NetworkApply ${node}: ${why}`));

export const applyNetwork = (props: NetworkApplyProps) =>
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
     * ⚠️ ONE LEASE FOR BOTH CALLS, VIA `runPveWith` RATHER THAN `runPve`. Each mint returns a NEW token
     *   id, and the task-status endpoint only skips its `Sys.Audit` check for the task's OWNER —
     *   so polling with a fresh mint is a different identity and needs a privilege this role does
     *   not have. The `provision` lease is 300s and non-renewable, which is far longer than a
     *   reload and is the reason no renew path is reached for.
     */
    // ⛔ BEFORE THE MINT AND THE RELOAD. The apply takes no body, so this is the lookup rather
    //   than a value check: a vendor that moved this endpoint fails here, not mid-ifreload.
    yield* guardNetworkApply;
    const credential = yield* mint(props.target, 'provision');
    const upid = text(
      yield* runPveWith(props.target, credential, true, nodes.putNodeNetwork({ node })),
    );
    if (upid === '') {
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
