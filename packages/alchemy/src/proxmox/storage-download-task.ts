/**
 * `download-url` and the content DELETE both answer a UPID (protocol.ts's "three 200-traps",
 * trap (a)) — bounded task observation on the exact credential that started the worker.
 * ★ THE SAME SHAPE AS qemu-task.ts/lxc-task.ts. Not merged with either: a fourth near-identical
 *   copy would be the moment to extract a shared poller, not this one (⚠️ flagged, not fixed here
 *   — see the PR description).
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import type { ProxmoxOpContext } from '@distilled.cloud/proxmox/Protocol';
import * as Effect from 'effect/Effect';
import { runPveWith } from './distilled-pve.ts';
import { mint } from './mint.ts';
import { StorageDownloadRefusedError } from './storage-download-errors.ts';
import { text } from './values.ts';
import type { PveTarget } from './credentials.ts';

export interface StorageDownloadWhere {
  readonly node: string;
  readonly target: PveTarget;
}

/**
 * ⛔ A CHECKSUM MISMATCH SURFACES HERE, NOT AS A DISTINCT TYPED ERROR. `download-url`'s POST
 *   answers 200 with a UPID regardless of whether the checksum will match — PVE validates the
 *   download itself, INSIDE the task, and reports the mismatch as that task's `exitstatus`. So
 *   the refusal below (`exit !== 'OK'`) IS the checksum-mismatch refusal: this poller fails the
 *   plan whenever the task did not report exactly `"OK"`, whatever the reason, without needing a
 *   new SDK tag to name it.
 */
export const storageDownloadTask = <E>(
  where: StorageDownloadWhere,
  operation: Effect.Effect<string, E, ProxmoxOpContext>,
  what: string,
  polls: number,
) =>
  Effect.gen(function* () {
    const credential = yield* mint(where.target, 'provision');
    const upid = text(yield* runPveWith(where.target, credential, true, operation));
    if (upid === '') {
      return yield* Effect.fail(
        new StorageDownloadRefusedError(
          `${what}: PVE returned no task id, so the write cannot be confirmed and is not claimed.`,
        ),
      );
    }
    let exit = 'still running when this provider stopped waiting';
    for (let attempt = 0; attempt < polls; attempt++) {
      const status = yield* runPveWith(
        where.target,
        credential,
        false,
        nodes.getNodeTaskStatus({ node: where.node, upid }),
      ).pipe(Effect.orElseSucceed(() => undefined));
      // ⚠️ Matches qemu-task.ts's own note: only exactly "stopped" ends the poll.
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
        new StorageDownloadRefusedError(
          `${what}: task ${upid} ended "${exit}". Read the task log before running the deploy again.`,
        ),
      );
    }
  });
