/**
 * `Proxmox.CephFs`'s distilled half: the index read and the create — see ceph-fs-wire.ts's own
 * header for why `destroyFs` stays there, on `client.ts`, unmigrated.
 *
 * ⛔ `nodes.updateNodeCephFs` IS distilled's GENERATOR MISNAMING A CREATE, NOT A SECOND ENDPOINT.
 *   Checked directly against its schema (`T.Http({ method: "POST", uri:
 *   "/nodes/{node}/ceph/fs/{name}" })`) rather than trusted from the function name — it is the
 *   SAME single write PVE registers, `createfs`. Harmless once named here for what it is.
 *
 * ★ THE SETTLE POLL IS A SEPARATE FUNCTION FROM ceph-fs-wire.ts's, NOT A SHARED ONE, because it
 *   calls a different task-status operation on a different transport — `nodes.getNodeTaskStatus`
 *   here, `pve()` there — but the POLICY is identical on purpose: same cadence
 *   (`POLL_SECONDS`/`POLL_ATTEMPTS`, imported, not retyped), same "an unreadable status is not
 *   settled yet, not a failure" tolerance. That tolerance is why this calls the RAW distilled
 *   operation directly. The former SDK `Task.awaitTask` propagated poll failures; SDK PR #265
 *   removed that helper because polling policy belongs in the provider. This bounded wait
 *   still tolerates a missing `Sys.Audit` grant or a node mid-restart until its deadline.
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import type { CephFsProps } from './ceph-fs.ts';
import { POLL_ATTEMPTS, POLL_SECONDS, createForm, objectPath, readRow } from './ceph-fs-wire.ts';
import { runPve } from './distilled-pve.ts';

/**
 * The index, read via distilled — the same shape `readRow` (ceph-fs-wire.ts) already narrows.
 *
 * ⛔ ABSENCE IS A SUCCESSFUL INDEX WITH NO MATCHING FILESYSTEM. The transport swap
 *   initially preserved the generic factory's catch-all fold. The 2026-09-24 follow-up removes it:
 *   a failed list is not proof that a filesystem is missing. Task polling below retains its
 *   separate bounded wait policy; it does not decide whether a resource exists.
 */
export const readFs = (props: CephFsProps) =>
  runPve(props.target, 'read', false, nodes.listNodeCephFs({ node: props.node })).pipe(
    Effect.map((rows) => readRow(rows as unknown as Record<string, unknown>, props)),
  );

/** `updateNodeCephFs`'s own request shape — `createForm`, translated. No field is renamed. */
const toDistilledCreate = (props: CephFsProps): nodes.UpdateNodeCephFsRequest =>
  ({
    ...createForm(props),
    name: props.name,
    node: props.node,
  }) as unknown as nodes.UpdateNodeCephFsRequest;

/** Wait for the create's forked task — the distilled twin of ceph-fs-wire.ts's `settle`. */
const settleCreate = (props: CephFsProps, upid: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const status = yield* runPve(
        props.target,
        'read',
        false,
        nodes.getNodeTaskStatus({ node: props.node, upid }),
      ).pipe(Effect.orElseSucceed(() => undefined));
      if (status?.status === 'stopped') {
        if (status.exitstatus === 'OK') return;
        return yield* Effect.die(
          new Error(
            `${objectPath(props)}: PVE task ${upid} finished with "${status.exitstatus ?? 'no exit status'}". ` +
              'The write returned HTTP 200 because it only forked the worker -- the real error is ' +
              `in \`pvesh get /nodes/${props.node}/tasks/${upid}/log\`.`,
          ),
        );
      }
      yield* Effect.sleep(POLL_SECONDS * 1000);
    }
    return yield* Effect.die(
      new Error(
        `${objectPath(props)}: PVE task ${upid} was still running after ` +
          `${String(POLL_ATTEMPTS * POLL_SECONDS)}s, or its status could not be read. Check the ` +
          'task log, and check that the `read` role holds Sys.Audit on ' +
          `/nodes/${props.node} -- each call mints a new token, so the poller is never the task ` +
          'owner and is answered 403 rather than told to wait.',
      ),
    );
  });

/** POST the create, then wait for the worker. ⛔ The caller still reads back; see ceph-fs.ts. */
export const createFs = (props: CephFsProps) =>
  Effect.gen(function* () {
    const upid = yield* runPve(
      props.target,
      'provision',
      true,
      nodes.updateNodeCephFs(toDistilledCreate(props)),
    );
    // ⛔ NO UPID MEANS NO WORKER. PVE answers 200 with `{"data":null}` on calls that did nothing,
    //   and here that is indistinguishable from success by status code alone. Refusing now is the
    //   difference between a clear failure and a state entry for a filesystem nobody built.
    if (upid === '') {
      return yield* Effect.die(
        new Error(
          `${objectPath(props)}: POST returned no task id. PVE wraps every answer in ` +
            '{"data":...} and can report success on a call that did nothing.',
        ),
      );
    }
    yield* settleCreate(props, upid);
  });
