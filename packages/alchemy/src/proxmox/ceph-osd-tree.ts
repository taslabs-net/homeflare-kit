/**
 * The CRUSH tree, walked down to one OSD leaf.
 *
 * ★ SPLIT OUT OF ceph-osd.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is the same
 *   one metric-server-form.ts cuts: this file answers "what does the cluster say about osd.N",
 *   ceph-osd.ts answers "what is an OSD and what may a plan do about it". Nothing here calls the
 *   API and nothing here decides a diff. `CephOsdAttributes` lives on this side of the seam
 *   because it is a description of what the TREE says — keeping each field's
 *   reported-never-compared reasoning against the line that builds it — and ceph-osd.ts re-exports
 *   it so a consumer still imports one name from one place. The `import type` back for
 *   `CephOsdProps` is a cycle on paper only: it is erased before anything runs.
 *
 * ⛔ `GET /nodes/{node}/ceph/osd` ANSWERS A TREE, NOT A LIST, AND IT IS THE WHOLE CLUSTER'S TREE.
 *   MEASURED 2026-09-13: asked of n2 it answers `{"flags":…,"root":{"children":[…]}}` whose
 *   leaves include osd.0 and osd.5 on n4; asked of n3 it answers the identical six leaves. The
 *   `{node}` in the path chooses WHO ANSWERS, not what is listed. A provider that read it as "the
 *   OSDs on this node" would find osd.0 through n2 and then report it as living there.
 *
 * ⛔ AND THE SINGLE-OBJECT PATH CANNOT BE USED INSTEAD — THIS WALK EXISTS BECAUSE IT LIES.
 *   MEASURED: `GET /nodes/n2/ceph/osd/99`, an id with no OSD behind it, answers HTTP 200 with
 *   `[{"name":"metadata"},{"name":"lv-info"}]` — byte for byte what `…/osd/2` answers for a real
 *   one. It is a directory index (its schema says `permissions: {"user":"all"}`), not a read of
 *   the OSD. Point `PveSpec.path` at it and every declared OSD is "present": `diff` reports
 *   `noop` over a dead replica forever, and `reconcile`'s read-back guard — the one thing that
 *   stops this package recording objects that do not exist — passes on an OSD that was never
 *   built. The only endpoint that can tell present from absent is the tree.
 *
 * ★ MEASURED ON TB4 ON 2026-09-13, `GET /nodes/n2/ceph/osd`. Six leaves, all `up` and `in`, Ceph
 *   20.2.2 tentacle:
 *
 *     id  name   host  device_class  crush_weight      reweight  pgs  status
 *     0   osd.0  n4    ssd           1.86299133300781  1          99  up
 *     5   osd.5  n4    ssd           1.86299133300781  1          94  up
 *     1   osd.1  n3    ssd           1.86299133300781  1          96  up
 *     4   osd.4  n3    ssd           1.81939697265625  1          97  up
 *     2   osd.2  n2    ssd           1.81939697265625  1          88  up
 *     3   osd.3  n2    ssd           1.81939697265625  1         105  up
 *
 *   `{ node: 'n2', osdid: 2, host: 'n2', device_class: 'ssd' }` plans `noop` against that row.
 *   That is the acceptance test this file was written to pass.
 *
 * ⚠️ EVERY OTHER COLUMN IS REPORTED AND NEVER COMPARED, FOR FOUR DIFFERENT REASONS. `pgs` is the
 *   autoscaler's placement rather than anybody's declaration — MEASURED, it spans 88 to 105 across
 *   six identical disks, and Ceph moves PGs whenever it rebalances. `crush_weight` is a FLOAT
 *   derived from device size (MEASURED: 1.86299133300781), so comparing it is float equality
 *   against a number Ceph recomputes on `crush reweight`. `reweight` is what
 *   `reweight-by-utilization` writes, unasked. `status` and `in` are daemon state: an OSD that
 *   flaps down while a node reboots would otherwise put work in the plan that no write this
 *   provider owns could ever clear. Each of those is the forever-update this package has already
 *   been bitten by, and each is out of `settled` below.
 *
 * ⚠️ THE CLUSTER'S OSD FLAGS ARE NOT AN ATTRIBUTE EITHER. The read carries
 *   `"flags":"sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit"` NEXT TO the root
 *   rather than inside any leaf: they describe the OSDMap, not this OSD. Recording them per-OSD
 *   would rewrite all six resources' state the moment somebody set `noout` for ten minutes of
 *   maintenance — the churn-that-reads-like-drift that keeps `digest` out of storage.ts.
 *
 */
import * as Effect from 'effect/Effect';
import type { CephOsdProps } from './ceph-osd.ts';
import { pve } from './client.ts';
import { bool, int, num, text } from './values.ts';

/** A CRUSH node. Buckets carry `children`; an OSD leaf carries `type: 'osd'`. */
type CrushNode = Record<string, unknown>;

const branches = (node: CrushNode): CrushNode[] =>
  (Array.isArray(node['children']) ? node['children'] : []).filter(
    (child): child is CrushNode => typeof child === 'object' && child !== null,
  );

/**
 * Every OSD leaf under the tree root, at any depth.
 *
 * ⚠️ RECURSIVE BECAUSE THE TREE IS NOT THREE LEVELS DEEP BY LAW. TB4 measures as
 *   root(`default`) -> host(n2|n3|n4) -> osd, but CRUSH admits datacenter, rack and chassis
 *   buckets between them, and an OSD created outside a host bucket hangs off the root. Reaching
 *   in as `root.children[].children[]` would read this cluster correctly and answer "absent" —
 *   i.e. "the replica is gone" — on the first cluster that has a rack in it.
 *
 * ⚠️ THE OUTERMOST OBJECT IS NOT ITSELF A BUCKET. MEASURED: `root` is `{"children":[…],"leaf":0}`
 *   with no `type` and no `name`; the bucket called `default` is its first child. So the walk
 *   starts at `tree.root` and selects on `type === 'osd'` rather than assuming a shape.
 */
export const osdLeaves = (tree: CrushNode): CrushNode[] => {
  const root = tree['root'];
  const start: CrushNode = typeof root === 'object' && root !== null ? (root as CrushNode) : {};
  const walk = (node: CrushNode): CrushNode[] => [
    ...(node['type'] === 'osd' ? [node] : []),
    ...branches(node).flatMap(walk),
  ];
  return walk(start);
};

/**
 * The leaf for one OSD id, or undefined when nothing in the tree carries it.
 *
 * ⛔ `id` COMES BACK AS A STRING HERE AND AS AN INTEGER EVERYWHERE ELSE, which is the "an id
 *   returned one way and written another" forever-diff in its most expensive form. MEASURED: the
 *   leaf for osd.2 carries `"id":"2"` (and the host buckets carry `"id":"-7"`), while
 *   `GET …/osd/2/metadata` carries `"id":2` and the `osdid` parameter on POST and DELETE is typed
 *   integer. `'2' === 2` is false, so a provider comparing the raw value finds NOTHING, calls
 *   every declared OSD absent — and, with a create path wired up, offers to build six OSDs over
 *   six live disks. `int` from values.ts is the narrowing, and `Number.NaN` is the fallback
 *   precisely because it equals nothing, id 0 included.
 *
 * ⚠️ FIRST MATCH WINS. OSD ids are unique cluster-wide, and PVE does not put the per-device-class
 *   shadow buckets (`default~ssd`) in this tree — MEASURED: the whole tree is one `default` root,
 *   three hosts, six leaves. If a future PVE did include them, taking the first match keeps the
 *   answer stable instead of reporting drift depending on which copy was walked into first.
 */
export const findOsd = (tree: CrushNode, osdid: number) =>
  osdLeaves(tree).find((leaf) => int(leaf['id'], Number.NaN) === osdid);

export interface CephOsdAttributes {
  /** Normalised to an integer here even though the tree spells it `"2"`. */
  osdid: number;
  /** `osd.2` — how Ceph, the UI and every log line name it. */
  name: string;
  /** COMPARED, but only when `props.host` is declared. */
  host: string;
  /** COMPARED, but only when `props.device_class` is declared. */
  device_class: string;
  /**
   * ⚠️ REPORTED, NEVER COMPARED — `bluestore` on every live OSD and filestore has been gone for
   *   years, so declaring it would add a field that cannot disagree. It is recorded because a
   *   future objectstore change is exactly the kind of thing state should have caught in writing.
   */
  osdtype: string;
  /** ⚠️ REPORTED, NEVER COMPARED. Daemon state — see the second ⚠️ in the header. */
  status: string;
  /** ⚠️ REPORTED, NEVER COMPARED. Ceph itself sets this to 0 after `mon_osd_down_out_interval`. */
  in: boolean;
  /** ⚠️ REPORTED, NEVER COMPARED. A float Ceph recomputes; comparing it is a permanent diff. */
  crush_weight: number;
  /** ⚠️ REPORTED, NEVER COMPARED. `reweight-by-utilization` owns this number, not a declaration. */
  reweight: number;
  /** ⚠️ REPORTED, NEVER COMPARED. The autoscaler moves PGs between OSDs whenever it likes. */
  pgs: number;
  /** Device capacity in bytes. Stable per disk, and the honest answer to "how big is this OSD". */
  total_space: number;
  /** `20.2.2`. ⚠️ Reported, never compared — an upgrade is not this resource's drift. */
  ceph_version: string;
}

/**
 * One leaf, as the attributes a plan and the state store get to see.
 *
 * ⚠️ THE TELEMETRY IS DELIBERATELY DROPPED, NOT FORGOTTEN. The leaf also carries `bytes_used`,
 *   `percent_used`, `apply_latency_ms` and `commit_latency_ms`. MEASURED, AND THE MEASUREMENT SAYS
 *   THE OPPOSITE OF WHAT YOU WOULD EXPECT: across two reads minutes apart, all four were identical
 *   on every OSD, and both latencies read 0 — TB4 was idle, so nothing was caught in the act. That
 *   these move is therefore REASONED, from what they count, not observed. Alchemy persists
 *   attributes; on a cluster doing work, keeping them would rewrite all six resources' state on
 *   every deploy and record a number that is stale by the time anybody reads it. What is kept is
 *   what a human asking "what is this replica, and is it healthy" needs; it is not a metrics feed.
 *
 * ⚠️ `osdid` AND `name` ARE THE NORMALISED ID AND ITS SPELLING, taken from the leaf rather than
 *   echoed from props, so that state records what the cluster said. They agree by construction
 *   here — the leaf was found BY id — but echoing props into attributes is how a resource ends up
 *   recording a declaration as though it were an observation.
 */
export const osdAttributes = (leaf: CrushNode, props: CephOsdProps): CephOsdAttributes => ({
  ceph_version: text(leaf['ceph_version_short']),
  crush_weight: num(leaf['crush_weight'], 0),
  device_class: text(leaf['device_class']),
  host: text(leaf['host']),
  in: bool(leaf['in']),
  name: text(leaf['name'], `osd.${String(props.osdid)}`),
  osdid: int(leaf['id'], props.osdid),
  osdtype: text(leaf['osdtype']),
  pgs: num(leaf['pgs'], 0),
  reweight: num(leaf['reweight'], 0),
  status: text(leaf['status']),
  total_space: num(leaf['total_space'], 0),
});

/**
 * The live OSD as attributes, or undefined.
 *
 * ★ IT LIVES HERE RATHER THAN IN ceph-osd.ts BECAUSE THE READ SIDE IS THIS FILE'S WHOLE JOB —
 *   `findOsd` and `osdAttributes` are the two halves it composes, and keeping the caller beside
 *   them is what let ceph-osd.ts come back under the 250-line cap when create and delete were
 *   added. ⚠️ A 404 or a 403 both arrive here as `undefined`: see the ⛔ on `readRole` in
 *   resource.ts for why that distinction is invisible and what it costs.
 */
export const readOsd = (props: CephOsdProps) =>
  pve<Record<string, unknown>>(props.target, 'read', 'GET', `nodes/${props.node}/ceph/osd`).pipe(
    Effect.map((t) => {
      const leaf = t === undefined ? undefined : findOsd(t, props.osdid);
      return leaf === undefined ? undefined : osdAttributes(leaf, props);
    }),
  );
