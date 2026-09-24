/**
 * `Proxmox.CephDaemon`'s distilled wire lane: one dispatch per kind, because mon/mgr/mds are three
 * separate distilled operations with three separate request shapes (`{node,monid}` /
 * `{node,id}` / `{node,name}`) — the SAME reason `DAEMON_ENDPOINTS` (ceph-daemon-form.ts) is a
 * per-kind table rather than one templated string.
 *
 * ⛔ ABSENCE IS A SUCCESSFUL INDEX WITH NO MATCHING ROW. The original transport swap
 *   preserved `pveOperations.read`'s catch-all fold; the 2026-09-24 follow-up removes it. A failed
 *   mon/mgr/mds list proves nothing about whether a daemon exists, so its SDK error propagates.
 *
 * ⚠️ `mon_address` IS THE ONE RENAME THIS FAMILY NEEDS — distilled's generator maps the wire name
 *   `mon-address` to `mon_address` on `UpdateNodeCephMonRequest` (`T.Body("mon-address")`,
 *   confirmed against its schema), the same one-key pattern node-network-form.ts's `RENAMED`
 *   table carries for three fields. `hotstandby` needs no rename.
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import type { CephDaemonKind, CephDaemonProps } from './ceph-daemon.ts';
import { daemonAttributes, daemonId, daemonPath } from './ceph-daemon-form.ts';
import { runPve } from './distilled-pve.ts';

/**
 * The index, per kind — the same array `daemonAttributes`/`findRow` already narrow.
 *
 * ⚠️ CAST TO `unknown[]` PER BRANCH, NOT LEFT TO INFERENCE. mon/mgr/mds answer three DIFFERENT
 *   row shapes (`ListNodeCephMonResponseBodyItem` and its two siblings), and a switch returning
 *   each as-is infers their INTERSECTION rather than their union — TypeScript refuses that under
 *   `exactOptionalPropertyTypes`. `daemonAttributes` already treats the row generically (it reads
 *   by string key, the same shape acl.ts narrows), so the cast costs nothing real.
 */
const listRows = (props: CephDaemonProps) => {
  const node = props.node;
  switch (props.kind) {
    case 'mon':
      return runPve(props.target, 'read', false, nodes.listNodeCephMon({ node })).pipe(
        Effect.map((rows): unknown[] => rows),
      );
    case 'mgr':
      return runPve(props.target, 'read', false, nodes.listNodeCephMgr({ node })).pipe(
        Effect.map((rows): unknown[] => rows),
      );
    case 'mds':
      return runPve(props.target, 'read', false, nodes.listNodeCephMds({ node })).pipe(
        Effect.map((rows): unknown[] => rows),
      );
  }
};

/** A missing row is absent; a failed index read keeps its typed SDK error. */
export const readDaemon = (props: CephDaemonProps) =>
  listRows(props).pipe(
    Effect.map((rows) => daemonAttributes(rows as unknown as Record<string, unknown>, props)),
  );

/** POST — distilled's generator misnames it "update" (checked against `T.Http`); it is a create. */
export const createDaemon = (props: CephDaemonProps) => {
  const node = props.node;
  const id = daemonId(props);
  switch (props.kind) {
    case 'mon':
      return runPve(
        props.target,
        'provision',
        true,
        nodes.updateNodeCephMon({
          ...(props['mon-address'] === undefined ? {} : { mon_address: props['mon-address'] }),
          monid: id,
          node,
        }),
      );
    case 'mgr':
      return runPve(props.target, 'provision', true, nodes.updateNodeCephMgr({ id, node }));
    case 'mds':
      return runPve(
        props.target,
        'provision',
        true,
        nodes.updateNodeCephMds({
          ...(props.hotstandby === undefined ? {} : { hotstandby: props.hotstandby ? '1' : '0' }),
          name: id,
          node,
        }),
      );
  }
};

/** ⚠️ NO FLAGS ON ANY OF THE THREE — unlike CephFs/CephOsd, nothing here is at risk of a
 *   DELETE-body PVE would ignore, because nothing here is ever sent. */
export const deleteDaemon = (props: CephDaemonProps) => {
  const node = props.node;
  const id = daemonId(props);
  switch (props.kind) {
    case 'mon':
      return runPve(props.target, 'provision', true, nodes.deleteNodeCephMon({ monid: id, node }));
    case 'mgr':
      return runPve(props.target, 'provision', true, nodes.deleteNodeCephMgr({ id, node }));
    case 'mds':
      return runPve(props.target, 'provision', true, nodes.deleteNodeCephMds({ name: id, node }));
  }
};

/** Re-exported so ceph-daemon.ts can narrow a switch exhaustively without importing the union twice. */
export type { CephDaemonKind };

/** ★ Moved here from ceph-daemon.ts's `reconcile` for the 250-line cap — matches ceph-fs.ts's own
 *  `notCreated`/`notDestroyed` seam: the message, not the decision to die, lives with the calls. */
export const notCreated = (props: CephDaemonProps) =>
  new Error(
    `${daemonPath(props)}: no ${props.kind} named ${daemonId(props)} in GET nodes/` +
      `${props.node}/ceph/${props.kind} after the create task finished. POST answers a UPID, ` +
      'not a result -- watch the task in the PVE UI (ceph-daemon-form.ts).',
  );
