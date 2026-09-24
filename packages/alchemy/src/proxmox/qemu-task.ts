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
      if (status === undefined || !['running', 'stopped'].includes(status.status)) {
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
