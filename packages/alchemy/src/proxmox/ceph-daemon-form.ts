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
 *   on n2, 2026-09-13: there is no GET on the id path — `pvesh get /nodes/n2/ceph/mon/n2` answers
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
import type { CephDaemonProps } from './ceph-daemon.ts';
import { flag } from './values.ts';

/**
 * PVE defaults the id to the nodename for all three kinds, and that default is resolved HERE
 * rather than left to PVE, because the id is a PATH SEGMENT: create, delete and the row lookup in
 * ceph-daemon.ts all need the same string, and a default resolved on the far side would leave
 * three call sites guessing. Live on this cluster every daemon's name equals its node.
 */
export const daemonId = (props: CephDaemonProps) => props.name ?? props.node;

/**
 * The read path. ⚠️ `{node}` HERE IS ONLY THE NODE BEING ASKED, not a filter. MEASURED:
 *   `GET /nodes/n2/ceph/mon` returns n2, n3 AND n4, and `GET /nodes/n3/ceph/mon` returns the same
 *   three IN A DIFFERENT ORDER — [n4,n2,n3] from n2 against [n3,n2,n4] from n3. A caller that took
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
