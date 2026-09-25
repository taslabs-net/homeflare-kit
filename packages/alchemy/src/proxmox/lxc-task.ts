/** LXC task observation is bounded and uses the exact credential that started the worker. */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import type { ProxmoxOpContext } from '@distilled.cloud/proxmox/Protocol';
import * as Effect from 'effect/Effect';
import { runPveWith } from './distilled-pve.ts';
import { LxcRefusedError, type LxcWhere } from './lxc-errors.ts';
import { mint } from './mint.ts';
import { text } from './values.ts';

/**
 * ⛔ Fresh provision mint for each write, then retain it for every task poll. PVE's task
 *   owner skips Sys.Audit; another mint is another token identity. This also gives a create
 *   the full lease rather than a cached lease with only 60 seconds left.
 * ⚠️ A failed post-write poll is uncertainty, never absence or permission to retry the write.
 *   Preserve the existing one-second bound and the UPID diagnostic. NetworkApply keeps its
 *   separate raw helper; migrating this caller does not alter reload behavior.
 * ★ SDK labels are percent-encoded. Installed APIServer/AnyEvent.pm uri_unescape runs before
 *   routing, so an encoded UPID reaches the same task as its old literal spelling.
 */
export const lxcTask = <E>(
  where: LxcWhere,
  operation: Effect.Effect<string, E, ProxmoxOpContext>,
  what: string,
  polls: number,
) =>
  Effect.gen(function* () {
    const credential = yield* mint(where.target, 'provision');
    const upid = text(yield* runPveWith(where.target, credential, true, operation));
    if (upid === '')
      return yield* Effect.fail(
        new LxcRefusedError(
          `${what}: PVE returned no task id, so the write cannot be confirmed and is not claimed.`,
        ),
      );
    let exit = 'still running when this provider stopped waiting';
    for (let attempt = 0; attempt < polls; attempt++) {
      const status = yield* runPveWith(
        where.target,
        credential,
        false,
        nodes.getNodeTaskStatus({ node: where.node, upid }),
      ).pipe(Effect.orElseSucceed(() => undefined));
      // ⚠️ "COULD NOT BE READ" IS A MISSING ANSWER OR A MISSING `status` FIELD, NOT AN UNEXPECTED
      //   ONE. `GetNodeTaskStatusResponseStatus` types `status` as the closed union
      //   `"running" | "stopped"`, but the runtime validator is `S.String` (measured in
      //   distilled-proxmox's nodes.ts) and MEASURED here to accept an empty `{}` for a malformed
      //   `data: null` answer (status.status undefined, no decode error) — so `status.status ===
      //   undefined` is the real "unreadable" signal, matching network-apply-read.ts's `awaitTask`
      //   and this file's own malformed-answer test. A well-formed answer with a status word this
      //   endpoint's contract was never proven to exclude (something other than exactly "running")
      //   must keep polling rather than abort, since only "stopped" ends the task
      //   (2026-09-25 adversarial review).
      if (status === undefined || status.status === undefined) {
        exit =
          'the task could not be read -- the node stopped answering, or this lease cannot see it';
        break;
      }
      if (status.status === 'stopped') {
        exit = text(status.exitstatus, 'stopped with no exitstatus');
        break;
      }
      yield* Effect.sleep('1 second');
    }
    if (exit !== 'OK')
      return yield* Effect.fail(
        new LxcRefusedError(
          `${what}: task ${upid} ended "${exit}". Read \`pvesh get /nodes/${where.node}/tasks/` +
            `${upid}/log\` before running the deploy again.`,
        ),
      );
  });
