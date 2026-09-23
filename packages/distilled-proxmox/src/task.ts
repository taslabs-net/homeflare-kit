/**
 * Awaiting a PVE task — trap (a) from `src/protocol.ts`'s header.
 *
 * PVE answers a long-running action (VM start, backup, migration, …) with
 * HTTP 200 and a bare UPID string the moment the task is QUEUED, not once
 * it finishes. The only way to know whether it actually succeeded is to
 * poll `GET /nodes/{node}/tasks/{upid}/status` — this package's generated
 * `Services.nodes.getNodeTaskStatus` — until the response carries an
 * `exitstatus`, and then check that value.
 *
 * ⛔ `exitstatus` IS COMPARED FOR EXACT EQUALITY TO `"OK"`, NEVER A PREFIX
 *   OR SUBSTRING CHECK. PVE also answers `"OK (warnings)"` (the task
 *   finished with recoverable warnings) — `startsWith("OK")` would treat
 *   that as an ordinary success and swallow the warning entirely, and
 *   `includes("OK")` is even looser. Anything other than the literal
 *   string `"OK"` — `"OK (warnings)"` included — fails with
 *   {@link ProxmoxTaskFailed}, carrying the vendor's own text verbatim so a
 *   caller that wants to treat warnings as success can still do so by
 *   matching on the message.
 *
 * `awaitTask` does not itself apply a deadline — wrap the call with
 * `Effect.timeout` (or `Retry.transient`/a caller-supplied policy) the way
 * any other Effect program composes one; a fixed timeout baked in here
 * would be wrong for a backup that legitimately runs for hours and right
 * for a config reload that should fail fast, and this module cannot know
 * which operation queued the UPID it was handed.
 */
import * as Effect from "effect/Effect";
import type * as Duration from "effect/Duration";
import type { ProxmoxOpContext } from "./protocol.ts";
import { ProxmoxTaskFailed } from "./errors.ts";
import * as nodes from "./services/nodes.ts";
import type {
  GetNodeTaskStatusError,
  GetNodeTaskStatusResponse,
} from "./services/nodes.ts";

/** Identifies one PVE task. `node` is the cluster member that OWNS the task — see the module header. */
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
 * `exitstatus` is exactly `"OK"`; fails with {@link ProxmoxTaskFailed}
 * for any other `exitstatus`, or with whatever `getNodeTaskStatus` itself
 * failed with (a typed HTTP error, `ClusterNodeUnreachable` if the node
 * this task lives on drops out of the cluster mid-poll, …).
 */
export const awaitTask = (
  ref: TaskRef,
  options: AwaitTaskOptions = {},
): Effect.Effect<
  GetNodeTaskStatusResponse,
  ProxmoxTaskFailed | GetNodeTaskStatusError,
  ProxmoxOpContext
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
          new ProxmoxTaskFailed({
            node: ref.node,
            upid: ref.upid,
            exitstatus: status.exitstatus,
          }),
        );
      }
      return status;
    }
  });
