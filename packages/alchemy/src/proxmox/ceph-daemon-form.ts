/**
 * Where a Ceph daemon lives on the API, and what a declaration of one looks like as a PVE form.
 *
 * ★ SPLIT OUT OF ceph-daemon.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is a real
 *   one rather than a convenient line number — the same seam metric-server-form.ts cuts on.
 *   This file answers "how does a declaration address ONE daemon" — which URL, which body, and
 *   which row of the collection's answer is it. ceph-daemon.ts answers "what does the cluster
 *   say about that daemon, and when has it changed". Nothing here calls the API and nothing
 *   here decides a diff; `findRow` picks a row out of an answer its caller already fetched.
 *
 * ⛔ THE TWO PATHS ARE DIFFERENT AND THAT IS THE WHOLE REASON THIS FILE HAS TWO OF THEM. MEASURED
 *   on node-b, 2026-09-13: there is no GET on the id path — `pvesh get /nodes/node-b/ceph/mon/node-b` answers
 *   "No 'get' handler defined" — while POST and DELETE are registered ONLY there. So the read uses
 *   `collectionPath` and the two writes use `daemonPath`, and swapping either one is a silent
 *   501: a create that never lands, or a destroy that reports failure while the daemon runs on.
 *
 * ⚠️ THE `import type` BACK TO ceph-daemon.ts IS A CYCLE ON PAPER ONLY — type-only, so it is
 *   erased before anything runs. `CephDaemonProps` stays the resource's public shape, in the file
 *   that declares the resource.
 *
 * ⛔ POST AND DELETE RETURN A UPID, NOT AN OBJECT — both are `protected` task endpoints whose
 *   schema `returns` is a bare string. REASONED, NOT MEASURED: this cluster is read-only to me, so
 *   no create was ever run. The consequence to expect is that `reconcile` reads back immediately
 *   after the POST, and if the worker has not yet written ceph.conf the read-back still says
 *   absent and reconcile dies with "the write returned no error but the object is still absent".
 *   That refusal is honest — nothing is recorded for an object that is not there — and a second
 *   deploy converges once the task has finished, but it is a confusing FIRST-RUN failure. Watch
 *   the task in the PVE UI before concluding the create failed.
 *
 */
import type { CephDaemonAttributes, CephDaemonKind, CephDaemonProps } from './ceph-daemon.ts';
import type { EndpointKey } from './constraints.ts';
import { bool, flag, num, text } from './values.ts';

/**
 * The vendor endpoint each kind is created at, as the generated tables key it.
 *
 * ⛔ ONE PER KIND, NOT A `{type}` PATH. PVE registers `mds`, `mgr` and `mon` as three separate
 *   nodes with three separate parameter schemas — `hotstandby` belongs to the first and
 *   `mon-address` to the third — so a single key would enforce one kind's rules on all three.
 *   `ceph-daemon.ts` indexes this by `props.kind` for exactly that reason, on every `guardWrite`.
 * ⛔ THE STRINGS MUST STAY LITERALS. `codegen/constraints.ts` finds the endpoints to table by
 *   SCANNING THIS PACKAGE'S TEXT, so a key assembled from `props.kind` would be tabled by
 *   nothing and `constraintsFor` would throw on the first deploy that reached it.
 * ⚠️ THE PARAMETER NAMES DIFFER AND ARE THE VENDOR'S OWN — `{name}`, `{id}`, `{monid}`. The
 *   generator resolves each against the schema, so a tidied-up spelling stops the build.
 * ⚠️ NO `update` HERE: none of the three kinds has a PUT — ceph-daemon-wire.ts's own header.
 */
export const DAEMON_ENDPOINTS: Readonly<Record<CephDaemonKind, EndpointKey>> = {
  mds: 'pve:POST /nodes/{node}/ceph/mds/{name}',
  mgr: 'pve:POST /nodes/{node}/ceph/mgr/{id}',
  mon: 'pve:POST /nodes/{node}/ceph/mon/{monid}',
};

/**
 * PVE defaults the id to the nodename for all three kinds, and that default is resolved HERE
 * rather than left to PVE, because the id is a PATH SEGMENT: create, delete and the row lookup in
 * ceph-daemon.ts all need the same string, and a default resolved on the far side would leave
 * three call sites guessing. Live on this cluster every daemon's name equals its node.
 */
export const daemonId = (props: CephDaemonProps) => props.name ?? props.node;

/**
 * The read path. ⚠️ `{node}` HERE IS ONLY THE NODE BEING ASKED, not a filter. MEASURED:
 *   `GET /nodes/node-b/ceph/mon` returns node-b, node-c AND node-d, and `GET /nodes/node-c/ceph/mon` returns the same
 *   three IN A DIFFERENT ORDER — [node-d,node-b,node-c] from node-b against [node-c,node-b,node-d] from node-c. A caller that took
 *   row zero, or assumed the list was this node's daemons, would be wrong on both counts.
 */
export const collectionPath = (props: CephDaemonProps) => `nodes/${props.node}/ceph/${props.kind}`;

/** The write path: POST creates here, DELETE destroys here. Never read from — see the ⛔ above. */
export const daemonPath = (props: CephDaemonProps) => `${collectionPath(props)}/${daemonId(props)}`;

/**
 * The create body, which is EMPTY for a mgr and nearly empty for the other two.
 *
 * ⚠️ THE ID IS NOT SENT, because it is already the last segment of the path being POSTed to — the
 *   same reasoning as metric-server.ts, where a second copy of the key can only disagree with the
 *   first. PVE's schema does accept `monid`/`id`/`name` as body parameters; the path wins, so
 *   sending one would be a second source of truth for the object's identity and nothing else.
 *
 * ⚠️ AND THE BRANCHES CANNOT BE ONE SHARED BODY. `hotstandby` is an mds parameter and
 *   `mon-address` a mon one; each POST schema lists only its own, so the wrong field is a 400
 *   rather than an ignored hint. Both are create-only — the ⛔s on those props say why neither is
 *   ever compared afterwards.
 */
export const createForm = (props: CephDaemonProps): Record<string, string> => {
  if (props.kind === 'mon' && props['mon-address'] !== undefined) {
    return { 'mon-address': props['mon-address'] };
  }
  const hotstandby = props.kind === 'mds' ? flag(props.hotstandby) : undefined;
  return hotstandby === undefined ? {} : { hotstandby };
};

/**
 * ⚠️ THE COLLECTION ANSWERS AN ARRAY while the factory types `attributes`' first parameter as the
 *   `Record<string, unknown>` every other PVE read is shaped like — the same mismatch acl.ts
 *   carries, handled the same way: narrow the rows, trust none of them, and match on `name`.
 * ⚠️ MATCHED ON `name` ALONE, NEVER ON POSITION — the list comes back in a different order
 *   depending on which node was asked. See the ⚠️ on `collectionPath` above.
 */
export const findRow = (live: unknown, props: CephDaemonProps) =>
  (Array.isArray(live) ? live : [])
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .find((row) => row['name'] === daemonId(props));

/**
 * One live row as attributes, or `undefined` — "no daemon of this kind carries this name".
 *
 * ★ HERE RATHER THAN IN ceph-daemon.ts FOR THE REASON THAT FILE'S SIBLING EXISTS AT ALL: the
 *   250-line cap, and a seam that is real. It reads the row `findRow` picked out of an answer its
 *   caller already fetched, three lines above, so the lookup and the mapping now live together
 *   instead of a function call apart.
 *
 * ⚠️ `undefined` WHEN NO ROW CARRIES THIS NAME: that is how the factory learns to create.
 */
export const daemonAttributes = (
  live: Record<string, unknown>,
  props: CephDaemonProps,
): CephDaemonAttributes | undefined => {
  const row = findRow(live, props);
  if (row === undefined) return undefined;
  return {
    addr: text(row['addr']),
    fsName: text(row['fs_name']),
    host: text(row['host']),
    kind: props.kind,
    name: daemonId(props),
    node: props.node,
    quorum: bool(row['quorum']),
    rank: num(row['rank'], -1),
    service: bool(row['service']),
    standbyReplay: bool(row['standby_replay']),
    state: text(row['state']),
    version: text(row['ceph_version_short']),
  };
};
