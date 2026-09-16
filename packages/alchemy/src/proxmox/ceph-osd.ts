/**
 * `Proxmox.CephOsd` — one OSD in the cluster's CRUSH tree.
 *
 * ⛔ CREATE AND DELETE ARE IMPLEMENTED AND `root@pam` IS THE ONLY IDENTITY THAT CAN RUN THEM.
 *   That is PVE's restriction, not this package's caution, and it is MEASURED from the cluster's
 *   own schema (`/usr/share/pve-docs/api-viewer/apidoc.js`, 2026-09-13):
 *
 *     GET    /nodes/{node}/ceph/osd          -> {"check":["perm","/",["Sys.Audit","Datastore.Audit"],"any",1]}
 *     POST   /nodes/{node}/ceph/osd          -> *** no permissions block at all ***
 *     DELETE /nodes/{node}/ceph/osd/{osdid}  -> *** no permissions block at all ***
 *
 *   A PVE method with no permissions block is refused to every identity except `root@pam`, so an
 *   OpenBao-minted `hf-provision@pve!…` token is answered 403 however wide its role — widening
 *   `LXCProvisioner` cannot fix it. Compare the sibling families, which DO carry a check and
 *   therefore do work with a token: `ceph/fs`, `ceph/mon` and `disks/zfs` all want `Sys.Modify`.
 *
 * ⚠️ SO THE WRITE PATH IS HONEST RATHER THAN USEFUL. It is written out properly in
 *   `ceph-osd-write.ts` — read that file for what each verb destroys — and it will work for an
 *   operator running as root@pam. Through this package's credential it will 403, and a 403 is a
 *   better answer than a `delete` that silently does nothing while the plan claims otherwise.
 *
 * ★ WHAT IT IS ACTUALLY FOR, THEN: ASSERTION. It turns "n2, n3 and n4 each hold two ssd OSDs"
 *   into a line a plan checks, and it gives Ceph-backed resources something real to depend on —
 *   read `osd.osdid` into an `rbd` storage's props and Alchemy orders that storage after the
 *   assertion, so a stack can no longer report a healthy Ceph storage on a cluster whose OSDs are
 *   gone. A replica that disappears becomes work in `plan` and a loud failure on the deploy.
 *
 * ⛔ THE WRITE VERBS MAY NOT EVEN BE REACHABLE FOR THIS PACKAGE'S CREDENTIAL. MEASURED from the
 *   cluster's own schema (`/usr/share/pve-docs/api-viewer/apidoc.js`, 2026-09-13): `index`,
 *   `osdindex`, `metadata` and `lv-info` each declare a `permissions` block, while `createosd`
 *   and `destroyosd` declare NONE — the key is absent, not empty. REASONED, NOT MEASURED: PVE
 *   refuses a method with no permissions block to everyone but `root@pam`, so an OpenBao-minted
 *   `hf-provision@pve!…` token would likely be answered 403 however wide its role. That is a
 *   reason to leave the write lane closed, not something to confirm by trying: if the reasoning
 *   is wrong, the confirmation costs a disk.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { CephOsdAttributes } from './ceph-osd-tree.ts';
import { readOsd } from './ceph-osd-tree.ts';
import { createOsd, destroyOsd } from './ceph-osd-write.ts';
import type { PveRequirements } from './resource.ts';
import type { WithTarget } from './resource.ts';

/**
 * ⚠️ RE-EXPORTED, NOT DECLARED HERE — it is built in ceph-osd-tree.ts, next to the walk that fills
 *   it in and to the reasoning for which of its fields may be compared. One name, one import.
 */
export type { CephOsdAttributes };

export interface CephOsdProps extends WithTarget {
  /**
   * Which node ANSWERS the read — not where the OSD lives. MEASURED: the tree n2 returns and the
   * tree n3 returns are the same six leaves, n4's included. Point this at any node that is up;
   * `host` is the field that says where the disk is.
   */
  node: string;
  /** `2` for `osd.2`. Identity, and an INTEGER — see the ⛔ on `findOsd` in ceph-osd-tree.ts. */
  osdid: number;
  /**
   * The CRUSH host bucket this OSD must sit in. Undeclared means unmanaged, as in storage.ts.
   *
   * ⚠️ DECLARING IT IS AN ASSERTION WITH NO REPAIR. If osd.2 turns up under n3, the plan reports
   *   work every time and the deploy fails, because moving an OSD between failure domains is a
   *   `ceph osd crush move` this provider will not perform. That is the intent: a replica in the
   *   wrong failure domain is not something to converge quietly past.
   */
  host?: string;
  /**
   * `ssd` | `hdd` | `nvme`, asserted the same way as `host`.
   *
   * ⚠️ THE READ'S SPELLING IS KEPT rather than the create parameter's (`crush-device-class`).
   *   This resource never writes, so the tree's name is the only one it has, and inventing a
   *   second name for one field is exactly what values.ts exists to stop.
   */
  device_class?: string;
  /**
   * The block device to build this OSD from, e.g. `/dev/nvme1n1`. Declaring it makes the resource
   * able to CREATE; leaving it out keeps the resource a pure assertion over an OSD that exists.
   *
   * ⛔ EVERYTHING ON THIS DEVICE IS DESTROYED BY A CREATE. `POST /nodes/{node}/ceph/osd` hands it
   *   to `ceph-volume lvm create`, which zaps it. Declare it only for a disk that is genuinely
   *   blank, and read the ⛔ about id allocation below before assuming the create will land as the
   *   `osdid` written above.
   */
  dev?: string;
  /**
   * Zap the OSD's logical volumes on destroy (`cleanup=1`). Default false: the LVs are left behind
   * so the disk can be re-added without a rebuild, which is the recoverable choice.
   */
  cleanup?: boolean;
}

export interface ProxmoxCephOsd extends Resource<
  'Proxmox.CephOsd',
  CephOsdProps,
  CephOsdAttributes,
  never,
  PveRequirements
> {}

/**
 * ★ `retain` BY DEFAULT, FOLLOWING ALCHEMY'S OWN PRECEDENT. `GitHub.Repository` and
 *   `Cloudflare.Zone` default to retain "because their contents are irreplaceable"; an OSD is a
 *   replica of live data and qualifies twice over. Retain means DELETING THE DECLARATION DOES NOT
 *   DELETE THE OSD — Alchemy drops its state row and leaves the disk alone. `destroyOsd` is fully
 *   implemented in ceph-osd-write.ts and runs when the caller opts in with
 *   `.pipe(RemovalPolicy.destroy())`, so this is the Terraform `prevent_destroy` shape rather than
 *   a missing operation — and through a minted token it 403s anyway, per the ⛔ at the top.
 */
export const ProxmoxCephOsd = Resource<ProxmoxCephOsd>('Proxmox.CephOsd', {
  defaultRemovalPolicy: 'retain',
});

/**
 * The live OSD, or undefined when the tree has no leaf with that id.
 *
 * ⛔ NO `Effect.orElseSucceed(() => undefined)`, AND THAT IS THE ONE DELIBERATE DEPARTURE FROM
 *   `pveOperations.read`. The factory folds every failure into "absent" because a 404 is a
 *   legitimate answer on a per-object path — but this path is a COLLECTION that always exists
 *   while Ceph is installed, so a failure here is never "the OSD is gone". It is an unreachable
 *   node, an expired lease, a role without `Sys.Audit`, or a cluster with no Ceph at all. Folding
 *   those into "absent" would turn every one of them into the sentence "osd.2 is missing", which
 *   is the most alarming thing this provider can say and would be a lie in all four cases. Left
 *   to fail, the plan shows `PVE GET nodes/n2/ceph/osd -> 500: …` and names the real problem.
 */

/**
 * Whether the live OSD is the one that was declared.
 *
 * ⚠️ AN UNDECLARED FIELD IS NOT COMPARED, as in storage.ts: undeclared means unmanaged, and there
 *   is no default to fall back on — the whole point of a CRUSH placement is that it is a choice.
 *   Declaring nothing but `osdid` therefore asserts only presence, which is a perfectly good
 *   thing to assert about a replica and the safest declaration this resource accepts.
 */
const settled = (live: CephOsdAttributes, props: CephOsdProps) =>
  (props.host === undefined || props.host === live.host) &&
  (props.device_class === undefined || props.device_class === live.device_class);

const describe = (props: CephOsdProps) =>
  `osd.${String(props.osdid)} (read via nodes/${props.node}/ceph/osd)`;

/**
 * ⛔ HAND-WRITTEN RATHER THAN `pveHandlers(spec)`, and the reason is not that the shape does not
 *   fit — it fits perfectly, which is the danger. Given a spec, the factory's `reconcile` POSTs
 *   `createForm` at `collection` whenever the read says absent, and `destroy` DELETEs `path`.
 *   Wired to this family that is: build an OSD over whatever block device the props named, and
 *   remove a replica when somebody deletes a line from a stack file. acl.ts is the precedent for
 *   overriding the factory because PVE lacks a verb; this file overrides it because PVE HAS the
 *   verbs and they must not be reachable from a declaration.
 *
 * ⚠️ THERE IS NO `replace` PATH HERE AND THERE CANNOT BE ONE. Alchemy implements a replace as
 *   create-then-delete (or the reverse); with both of those refusing, `replace` could only ever
 *   be a failure wearing a different word. A changed `osdid` is simply a different assertion.
 */
const handlers = {
  /**
   * ⛔ EMPTY, as everywhere in this package, and here the stakes are at their highest. The tree is
   *   the whole cluster's — adopting it would hand Alchemy six resources it never created, each
   *   with a `delete` in its future. Adoption stays an explicit act, and for this family it stays
   *   an act with no teeth: see `delete` below.
   */
  list: () => Effect.succeed([]),

  read: Effect.fn(function* ({ olds }: { olds: CephOsdProps }) {
    return yield* readOsd(olds);
  }),

  /**
   * ⚠️ `update` IS THE LOUDEST WORD AVAILABLE, NOT A PROMISE TO FIX ANYTHING. Alchemy's Diff
   *   admits only noop/update/replace, so a missing or misplaced OSD has to be spelled `update`
   *   — and the deploy that follows fails on purpose in `reconcile`. A resource that answered
   *   `noop` over a replica that is not there would be the exact lie this package keeps writing
   *   guards against; a permanent entry in `plan` until a human puts a disk back is the cost, and
   *   it is the right cost for a degraded pool.
   */
  diff: Effect.fn(function* ({
    news,
    output,
  }: {
    news: Input<CephOsdProps>;
    output: CephOsdAttributes | undefined;
  }) {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* readOsd(news);
    if (live === undefined) return { action: 'update' } as const;
    /**
     * ⛔ THE RECORDED STATE MUST DESCRIBE THE OSD THE DECLARATION NOW NAMES. `settled` compares
     *   only host and device_class, so changing `osdid: 2` to `3` reads osd.3, finds it on the
     *   same host with the same class, and answers noop — which records nothing, leaving OSD 2's
     *   crush_weight, pgs and name in state under a declaration that says 3. It is the OUTPUT's id
     *   that must be checked: the LIVE id is found BY `news.osdid`, so comparing that is vacuous.
     */
    if (output.osdid !== news.osdid) return { action: 'update' } as const;
    return settled(live, news) ? ({ action: 'noop' } as const) : ({ action: 'update' } as const);
  }),

  /**
   * ⛔ THE ASSERTION, AND THE WHOLE REASON THIS PROVIDER IS HAND-WRITTEN. It reads, and then it
   *   either records what it found or dies. It never POSTs. The first deploy of a declaration is
   *   an adoption of an OSD that already exists; every later one is a check that it still does.
   */
  reconcile: Effect.fn(function* ({ news }: { news: CephOsdProps }) {
    const live = yield* readOsd(news);
    if (live === undefined) {
      /**
       * ⛔ CEPH ALLOCATES THE OSD ID; THE DECLARATION CANNOT CHOOSE IT. Measured from the schema:
       *   `POST /nodes/{node}/ceph/osd` requires `dev` and takes `crush-device-class`, `db_dev`,
       *   `wal_dev`, `encrypted` and `osds-per-device` — and NO id. The cluster assigns the next
       *   free number. So a create only lands on the declared `osdid` when that number happens to
       *   be the one Ceph picks, which for a fresh disk on a contiguous cluster it usually is.
       *   The read-back below is what keeps that from being a silent mismatch: if Ceph assigned a
       *   different id, the OSD this resource names is still absent and reconcile refuses.
       */
      return yield* createOsd(news);
    }
    if (!settled(live, news)) {
      return yield* Effect.die(
        new Error(
          `${describe(news)}: exists but not as declared -- live host=${live.host} ` +
            `device_class=${live.device_class}. Nothing here moves an OSD between hosts or ` +
            'reclassifies it; fix the declaration, or move it deliberately with `ceph osd crush ' +
            'move` / `ceph osd crush set-device-class` and deploy again.',
        ),
      );
    }
    return live;
  }),

  /**
   * ⛔ REMOVING THE DECLARATION REMOVES THE ASSERTION, NOT THE REPLICA — the resource defaults
   *   to `retain`, so this runs only on `.pipe(RemovalPolicy.destroy())`. What the DELETE actually
   *   does to a live pool is documented on `destroyOsd` in ceph-osd-write.ts.
   */
  delete: Effect.fn(function* ({ olds }: { olds: CephOsdProps }) {
    yield* destroyOsd(olds);
  }),
};

export const ProxmoxCephOsdProvider = () =>
  Provider.effect(ProxmoxCephOsd, Effect.succeed(ProxmoxCephOsd.Provider.of(handlers)));
