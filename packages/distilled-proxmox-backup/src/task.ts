/**
 * Awaiting a PBS task — trap (a) from `src/protocol.ts`'s header.
 *
 * Ported from `packages/proxmox/src/task.ts` unchanged in its polling
 * logic and exact-equality check — PBS answers a long-running action
 * (backup, sync job, garbage collection, tape write, …) with HTTP 200 and
 * a bare UPID string the moment the task is QUEUED, the same as PVE. The
 * only way to know whether it actually succeeded is to poll `GET /nodes/
 * {node}/tasks/{upid}/status` — this package's generated
 * `Services.nodes.getNodeTaskStatus` — until the response carries an
 * `exitstatus`, and then check that value.
 *
 * ⛔ `exitstatus` IS COMPARED FOR EXACT EQUALITY TO `"OK"`, NEVER A PREFIX
 *   OR SUBSTRING CHECK — carried from PVE's identical warning; not
 *   independently re-measured that PBS also answers `"OK (warnings)"`
 *   (no live PBS calls in this build), but the exact-equality form is
 *   strictly safer than a looser one either way, so there is no reason to
 *   weaken it pending that confirmation.
 *
 * `awaitTask` does not itself apply a deadline — wrap the call with
 * `Effect.timeout` (or `Retry.transient`/a caller-supplied policy).
 *
 * NOT carried from PVE: `ClusterNodeUnreachable` in the failure union —
 * see `src/errors.ts`'s header for why PBS has no cluster-forwarding trap.
 */
import * as Effect from "effect/Effect";
import type * as Duration from "effect/Duration";
import type { ProxmoxBackupOpContext } from "./protocol.ts";
import { ProxmoxBackupTaskFailed } from "./errors.ts";
import * as nodes from "./services/nodes.ts";
import type {
  GetNodeTaskStatusError,
  GetNodeTaskStatusResponse,
} from "./services/nodes.ts";

/** Identifies one PBS task. `node` is always the single PBS host — kept as a field for parity with `@distilled.cloud/proxmox`'s identical shape, and because the vendor schema's own path template names it `{node}` regardless. */
export interface TaskRef {
  readonly node: string;
  readonly upid: string;
}

export interface AwaitTaskOptions {
  /** Delay between polls. Default 1 second. */
  readonly pollInterval?: Duration.Input;
}

/**
 * Poll a task to completion. Resolves with the FINAL status response (so a
 * caller can read `pid`/`starttime`/etc. without a second call) once
 * `exitstatus` is exactly `"OK"`; fails with {@link ProxmoxBackupTaskFailed}
 * for any other `exitstatus`, or with whatever `getNodeTaskStatus` itself
 * failed with.
 */
export const awaitTask = (
  ref: TaskRef,
  options: AwaitTaskOptions = {},
): Effect.Effect<
  GetNodeTaskStatusResponse,
  ProxmoxBackupTaskFailed | GetNodeTaskStatusError,
  ProxmoxBackupOpContext
> =>
  Effect.gen(function* () {
    const pollInterval = options.pollInterval ?? "1 second";
    while (true) {
      const status = yield* nodes.getNodeTaskStatus({
        node: ref.node,
        upid: ref.upid,
      });
      if (status.exitstatus === undefined) {
        yield* Effect.sleep(pollInterval);
        continue;
      }
      if (status.exitstatus !== "OK") {
        return yield* Effect.fail(
          new ProxmoxBackupTaskFailed({
            node: ref.node,
            upid: ref.upid,
            exitstatus: status.exitstatus,
          }),
        );
      }
      return status;
    }
  });
