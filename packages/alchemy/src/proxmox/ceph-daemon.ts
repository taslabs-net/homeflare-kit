/**
 * `Proxmox.CephDaemon` — a Ceph monitor, manager or metadata server on one node.
 *
 * ★ ONE RESOURCE FOR THREE KINDS, AND THE SCHEMAS WERE CHECKED BEFORE THAT WAS DECIDED. Parsed
 *   from `/usr/share/pve-docs/api-viewer/apidoc.js` on node-b, 2026-09-13: mon, mgr and mds each
 *   expose GET on the collection and POST + DELETE on the id below it, each returns
 *   name/host/state/addr/ceph_version*, and the only divergence is the create parameter
 *   (`mon-address` / none / `hotstandby`) and the read-only extras (mon: quorum, rank; mds: rank,
 *   fs_name, standby_replay). Three near-identical files would have carried the traps below three
 *   times over and let them drift — the argument resource.ts already makes for the factory itself.
 *
 * ⛔ THE ONLY GET IS THE COLLECTION'S, AND IT ANSWERS FOR THE WHOLE CLUSTER. MEASURED:
 *   `GET /nodes/node-b/ceph/mon` returns node-b, node-c AND node-d, and `GET /nodes/node-c/ceph/mon` returns the same
 *   three IN A DIFFERENT ORDER — [node-d,node-b,node-c] from node-b, [node-c,node-b,node-d] from node-c — so a row is found by
 *   `name` and NEVER by position, and the `{node}` in the path is only the node being ASKED.
 *   MEASURED too: there is no GET on the id path at all; `pvesh get /nodes/node-b/ceph/mon/node-b` answers
 *   "No 'get' handler defined for '/nodes/node-b/ceph/mon/node-b'", and mgr and mds answer the same.
 *   That is why `path()` below is the COLLECTION, and that in turn is why `delete` is the one
 *   handler this file writes by hand: `pveOperations.destroy` sends its DELETE to `spec.path`,
 *   which here would be the collection — a 501 reported as a failed destroy, with the daemon still
 *   running. Same shape and same rule as the override in acl.ts: do not "restore symmetry" by
 *   pointing it back at `ops.destroy`.
 *
 * ⛔ WHAT A DESTROY ACTUALLY DOES, BECAUSE THE PLAN LINE SAYS ONLY "delete". REASONED FROM PVE'S
 *   AND CEPH'S DOCUMENTED BEHAVIOUR, NOT MEASURED — nothing on this cluster was destroyed to find
 *   out, and nothing should be to check. `mon`: stops ceph-mon@id, removes it from the monmap and
 *   strips its section from ceph.conf. THREE MONS TOLERATE ONE LOSS; TWO TOLERATE NONE. Removing
 *   two in one deploy — or removing the mon on the node whose API is serving the call — loses
 *   quorum, and a cluster without mon quorum BLOCKS every RBD and CephFS I/O rather than erroring
 *   it, so on this cluster every guest on `rbd-c1` hangs.
 *   `mds`: destroying a STANDBY is a non-event; destroying the ACTIVE one fails CephFS over,
 *   and with no standby left `cephfs-c1` goes unavailable. `mgr`: no guest I/O depends on it, but
 *   the last one takes the PG autoscaler, the dashboard and PVE's own Ceph status with it.
 *   Live on 2026-09-13: mon, mgr AND mds on each of node-b, node-c, node-d.
 *
 * ★ AND THE ONLY WAY TO REACH THAT DESTROY IS TO DELETE THE DECLARATION. `matches` is deliberately
 *   total (see its ⛔), so this resource CANNOT plan a `replace` — which is the one action that
 *   would tear down a live mon off the back of an edited field rather than a removed line.
 *
 * ⚠️ THE PRIVILEGES ARE ASYMMETRIC AND THE READ SIDE IS THE CHEAP ONE. The GET checks `any` of
 *   `Sys.Audit`/`Datastore.Audit` on `/`, and PVEAuditor holds both (MEASURED:
 *   `GET /access/roles/PVEAuditor`), so the mount's `read` role can see this family — unlike
 *   `Proxmox.Storage`, which 403s under that lease. POST and DELETE both check `Sys.Modify` on
 *   `/`, and MEASURED on this cluster the provision role already held it (it is in `PROVISION_PRIVILEGES`), so the provision lane
 *   needs no widening for once. ⚠️ `Sys.Modify` on the ROOT path is broad — it also buys
 *   datacenter options and every other cluster-wide config write — so it is worth knowing that
 *   this credential already has it rather than discovering it the next time something is scoped.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { collectionPath, createForm, daemonId, daemonPath, findRow } from './ceph-daemon-form.ts';
import { pve } from './client.ts';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { bool, num, text } from './values.ts';

/**
 * Which Ceph daemon this is. The discriminant picks the collection, the create parameters and
 * which of the read-only extras below will even be populated.
 *
 * ⚠️ `osd` IS NOT HERE AND MUST NOT BE ADDED TO THIS UNION. `/nodes/{node}/ceph/osd` takes a disk
 *   device, wipes it, and its DELETE has a `cleanup` flag — a create that destroys data on the way
 *   in is a different resource with a different set of refusals, not a fourth case in this one.
 */
export type CephDaemonKind = 'mon' | 'mgr' | 'mds';

export interface CephDaemonProps extends WithTarget {
  kind: CephDaemonKind;
  /**
   * The node the daemon RUNS on. Identity — a daemon cannot be moved, only destroyed and rebuilt.
   * ⚠️ It is also the node whose API is asked, and the read is only as available as that node: a
   *   node that is down — or has no Ceph installed, or answers 403 — reads as nothing at all,
   *   because `pveOperations.read` folds EVERY failure into "absent" (a 404 is a legitimate answer
   *   there and it cannot tell the two apart). Its daemons then plan as `update`, and reconcile
   *   POSTs a create for a mon that already exists. PVE refuses that with "monitor already
   *   exists", and the read-back refuses again — so it fails loudly rather than damaging anything,
   *   but the message will point at the daemon rather than at the node that would not answer.
   */
  node: string;
  /**
   * The daemon id. PVE defaults it to the nodename, and `daemonId` in ceph-daemon-form.ts resolves
   * that default HERE rather than leaving it to PVE, because the id is a PATH SEGMENT: create,
   * delete and the row lookup all need the same string, and a default resolved on the far side
   * would leave three call sites guessing. Live on this cluster every daemon's name is its node.
   */
  name?: string;
  /**
   * mon only. Overrides the autodetected monitor IP; must sit in Ceph's public network — on this
   * cluster that is 198.51.100.0/24, carried by `vmbr1.42`.
   * ⛔ CREATE-ONLY AND NEVER COMPARED. PVE takes a bare ip-list on write and hands back `addr` as
   *   `198.51.100.12:6789/0` — an address, a port and a nonce. The two are not the same string and
   *   never will be, so diffing them would report a mismatch on every plan; with no PUT on this
   *   family that mismatch becomes a REPLACE, and a replace of a mon is the quorum loss in the
   *   header. Left out of `matches` on purpose.
   */
  'mon-address'?: string;
  /**
   * mds only. Makes this standby replay the active MDS's journal for a faster failover.
   * ⛔ CREATE-ONLY AND NEVER COMPARED, AND THE FIELD THAT LOOKS LIKE ITS READBACK IS NOT ONE.
   *   `standby_replay` in the list is the daemon's CURRENT state, not its configuration: MEASURED
   *   2026-09-13, all three mds report `standby_replay: false`, node-c included — and node-c is the ACTIVE
   *   mds, which is not a standby at all and so can never report true however it was created.
   *   Comparing `hotstandby` to it would plan a replace against whichever mds Ceph happens to have
   *   elected, i.e. against a value no declaration controls.
   * ⚠️ SET ON A mon OR mgr IT IS DROPPED RATHER THAN SENT, and `mon-address` likewise on an mds:
   *   each POST schema lists only its own parameter, so the wrong one is a 400 rather than an
   *   ignored hint. A field silently dropped is the lesser of the two, but it IS dropped.
   */
  hotstandby?: boolean;
}

/**
 * Everything the cluster says about this daemon — reported, and (bar its identity) none of it
 * compared. Read the ⛔ on `matches` for why that is the only safe split on this family.
 */
export interface CephDaemonAttributes {
  kind: CephDaemonKind;
  node: string;
  name: string;
  /**
   * The host Ceph says it runs on.
   * ⚠️ REPORTED, NOT COMPARED, AND THAT IS A DELIBERATE BLIND SPOT. A daemon found under this name
   *   on a DIFFERENT node than `node` declares plans as `noop`, which does hide a misdeclaration.
   *   The alternative is worse: `host` is `optional` in the schema, so an absent one would read as
   *   a mismatch, and with no PUT a mismatch is a replace — i.e. a missing field in one API answer
   *   would destroy a live mon. When in doubt, out of `matches`; fix a wrong node by hand.
   */
  host: string;
  /**
   * mon `running`/`stopped`/`unknown`, mgr `active`/`standby`, mds `up:active`/`up:standby`/…
   * ⛔ CEPH ELECTS THIS AND REWRITES IT WITHOUT ANYONE DECLARING ANYTHING. MEASURED: mgr node-b is
   *   `active` while node-c and node-d are `standby`; mds node-c is `up:active` while node-b and node-d are
   *   `up:standby`. Restart a daemon and the roles move. It is reported so a plan can show what is
   *   live and kept out of `matches` so that an election is never a diff.
   * ⚠️ IT ALSO MEANS THIS RESOURCE DOES NOT MANAGE WHETHER THE DAEMON IS RUNNING. A configured but
   *   stopped daemon is still a row in the list, so it reads as present and plans `noop`.
   */
  state: string;
  /** Ceph-formatted, e.g. `198.51.100.12:6789/0`. Reported; see `mon-address` for why never compared. */
  addr: string;
  /** `ceph_version_short`, e.g. `20.2.2`. Reported: a straggler after an upgrade is worth seeing. */
  version: string;
  /**
   * mon rank in the monmap, mds rank in the filesystem, `-1` when the daemon has neither.
   * ⛔ CEPH ASSIGNS IT AND NOTHING DECLARES IT. MEASURED: the mons are ranked node-d=0, node-c=1, node-b=2 —
   *   monmap order, not declaration order — and the mds ranks are 0 for the active node-c and -1 for
   *   the two standbys. Rank moves when a daemon is added, removed or restarted.
   */
  rank: number;
  /** mon only: in the current quorum. Reported. MEASURED: all three mons are in quorum. */
  quorum: boolean;
  /** mds only, and NOT the readback of `hotstandby` — see the ⛔ on that prop. */
  standbyReplay: boolean;
  /**
   * mds only: the CephFS this daemon currently serves — `cephfs-c1` here.
   * ⛔ PRESENT ONLY ON THE ACTIVE MDS. MEASURED: node-c carries `fs_name`, node-b and node-d have no such key
   *   at all. So it is empty for two of three identical declarations, and comparing it would
   *   report work on exactly the daemons that are healthy standbys.
   */
  fsName: string;
  /** A `ceph-<kind>@<id>` systemd unit is enabled on the host. Reported; absent reads as false. */
  service: boolean;
}

export interface ProxmoxCephDaemon extends Resource<
  'Proxmox.CephDaemon',
  CephDaemonProps,
  CephDaemonAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a mon carrying quorum cannot be rebuilt. See the ★ in resource.ts. */
export const ProxmoxCephDaemon = Resource<ProxmoxCephDaemon>('Proxmox.CephDaemon', {
  defaultRemovalPolicy: 'retain',
});

const handlers = pveHandlers<CephDaemonProps, CephDaemonAttributes>({
  /** ⚠️ `undefined` when no row carries this name: that is how the factory learns to create. */
  attributes: (live, props) => {
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
  },
  /** ⛔ The ID path, not the collection — POST is registered on `{id}`, exactly like a metric server. */
  collection: daemonPath,
  createForm,
  /**
   * ⛔ TOTAL, AND THIS IS THE REASON THE FILE EXISTS RATHER THAN A SHORTCUT PAST WRITING IT. Every
   *   field a declaration can carry is CREATE-ONLY and unreadable — `mon-address` comes back as a
   *   different kind of string, `hotstandby` comes back as a state Ceph elects — and every field
   *   the read returns is assigned by Ceph: state, rank, quorum, fs_name, standby_replay, addr,
   *   version. Nothing is left that is both declared and readable. So the honest comparison is
   *   "does a daemon of this kind and name exist", which `attributes` has already answered by
   *   returning a value at all, and anything further would be a diff no write could ever satisfy.
   *   ⛔ AND ON THIS FAMILY THAT DIFF IS NOT MERELY NOISY. There is no PUT, so resource.ts answers
   *     `replace` rather than `update` whenever `matches` is false — and replace on a mon is
   *     delete-then-create against a live quorum. A forever-diff here is a forever-OUTAGE-RISK.
   *   ⚠️ THE PRICE, STATED PLAINLY: editing `hotstandby` or `mon-address` on a declared daemon
   *     plans as `noop` and never applies. Same bargain storage.ts strikes for a changed `type`.
   *     Change one by removing the declaration and re-adding it, ONE DAEMON AT A TIME, reading the
   *     ⛔ on destroy in the header first.
   */
  matches: () => true,
  /** ⛔ The COLLECTION, because there is no GET on the id path. See the second ⛔ in the header. */
  path: collectionPath,
  /** ⚠️ No `updateForm`: none of the three has a PUT, so nothing about a daemon is editable. */
});

export const ProxmoxCephDaemonProvider = () =>
  Provider.effect(
    ProxmoxCephDaemon,
    Effect.succeed(
      ProxmoxCephDaemon.Provider.of({
        ...handlers,
        /**
         * ⛔ THE ONE HANDLER NOT TAKEN FROM THE FACTORY, AND THE ONLY REASON IS THE PATH SPLIT.
         *   `ops.destroy` DELETEs `spec.path`, which this resource must point at the collection so
         *   that `read` works at all; DELETE on the collection is not implemented and would answer
         *   501 while the daemon kept running — a failed destroy that reads like a permissions
         *   problem. Everything else here is the factory's.
         * ⚠️ AND IT IS THE DANGEROUS ONE. Re-read the destroy ⛔ in the header before letting a
         *   plan that removes a mon run: two gone at once is a cluster with no quorum and every
         *   guest on `rbd-c1` blocked on I/O.
         */
        delete: ({ olds }: { olds: CephDaemonProps }) =>
          pve(olds.target, 'provision', 'DELETE', daemonPath(olds)),
      }),
    ),
  );
