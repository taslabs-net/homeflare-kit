/** Bounded QEMU task observation on the credential that started the worker. */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import type { ProxmoxOpContext } from '@distilled.cloud/proxmox/Protocol';
import * as Effect from 'effect/Effect';
import { runPveWith } from './distilled-pve.ts';
import { mint } from './mint.ts';
import { QemuRefusedError } from './qemu-errors.ts';
import type { VmProps } from './qemu.ts';
import { text } from './values.ts';

/**
 * ⛔ Fresh provision mint, then the same lease for every poll. A timed-out poll is uncertainty,
 *   never a reason to send the write again.
 */
export const qemuTask = <E>(
  props: VmProps,
  operation: Effect.Effect<string, E, ProxmoxOpContext>,
  what: string,
  polls: number,
) =>
  Effect.gen(function* () {
    const credential = yield* mint(props.target, 'provision');
    const upid = text(yield* runPveWith(props.target, credential, true, operation));
    if (upid === '') {
      return yield* Effect.fail(
        new QemuRefusedError(
          `${what}: PVE returned no task id, so the write cannot be confirmed and is not claimed.`,
        ),
      );
    }
    let exit = 'still running when this provider stopped waiting';
    for (let attempt = 0; attempt < polls; attempt++) {
      const status = yield* runPveWith(
        props.target,
        credential,
        false,
        nodes.getNodeTaskStatus({ node: props.node, upid }),
      ).pipe(Effect.orElseSucceed(() => undefined));
      // ⚠️ "COULD NOT BE READ" IS A MISSING ANSWER OR A MISSING `status` FIELD, NOT AN UNEXPECTED
      //   ONE. `GetNodeTaskStatusResponseStatus` types `status` as the closed union
      //   `"running" | "stopped"`, but the runtime validator is `S.String` (measured in
      //   distilled-proxmox's nodes.ts), so a well-formed answer with a status word this
      //   endpoint's contract was never proven to exclude (something other than exactly
      //   "running") must keep polling rather than abort, since only "stopped" ends the task
      //   (2026-09-25 adversarial review; matches lxc-task.ts and network-apply-read.ts's
      //   awaitTask).
      if (status === undefined || status.status === undefined) {
        exit = 'the task could not be read';
        break;
      }
      if (status.status === 'stopped') {
        exit = text(status.exitstatus, 'stopped with no exitstatus');
        break;
      }
      yield* Effect.sleep('1 second');
    }
    if (exit !== 'OK') {
      return yield* Effect.fail(
        new QemuRefusedError(
          `${what}: task ${upid} ended "${exit}". Read the task log before running the deploy again.`,
        ),
      );
    }
  });
