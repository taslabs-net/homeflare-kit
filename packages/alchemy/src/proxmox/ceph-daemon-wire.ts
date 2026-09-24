/**
 * `Proxmox.CephDaemon`'s distilled wire lane: one dispatch per kind, because mon/mgr/mds are three
 * separate distilled operations with three separate request shapes (`{node,monid}` /
 * `{node,id}` / `{node,name}`) — the SAME reason `DAEMON_ENDPOINTS` (ceph-daemon-form.ts) is a
 * per-kind table rather than one templated string.
 *
 * ⛔ ONE READ FUNCTION, NOT THE readXOrFail/foldingX PAIR — the same deliberate, measured
 *   departure ceph-pool-wire.ts and ceph-fs-distilled.ts explain in full: this family's
 *   pre-migration `pveOperations.read` (resource.ts) already folded every failure unconditionally,
 *   with no `output`-branching, so `readDaemon` below reproduces that exact single-fold shape
 *   rather than gaining the newer dual-path pattern along the way.
 *
 * ⚠️ `mon_address` IS THE ONE RENAME THIS FAMILY NEEDS — distilled's generator maps the wire name
 *   `mon-address` to `mon_address` on `UpdateNodeCephMonRequest` (`T.Body("mon-address")`,
 *   confirmed against its schema), the same one-key pattern node-network-form.ts's `RENAMED`
 *   table carries for three fields. `hotstandby` needs no rename.
 */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import type { CephDaemonKind, CephDaemonProps } from './ceph-daemon.ts';
import { daemonAttributes, daemonId } from './ceph-daemon-form.ts';
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

/** ⛔ FOLDS EVERY FAILURE TO `undefined` — see this file's own header for why. */
export const readDaemon = (props: CephDaemonProps) =>
  listRows(props).pipe(
    Effect.map((rows) => daemonAttributes(rows as unknown as Record<string, unknown>, props)),
    Effect.orElseSucceed(() => undefined),
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
