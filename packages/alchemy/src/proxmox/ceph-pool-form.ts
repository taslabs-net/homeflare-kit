/**
 * What a Ceph pool IS as a declaration, and the two different forms PVE wants it in.
 *
 * ★ SPLIT OUT OF ceph-pool.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is
 *   "does this touch the cluster" — the same one metric-server-form.ts draws, just with more on
 *   this side because this family needs it. Here: the declared shape, the reported shape, and the
 *   coercions that turn one into the other. There: reading TB4, deciding a diff, and the four
 *   handlers. Nothing in this file makes a call or decides an action.
 * ⚠️ THE PROPS LIVE HERE RATHER THAN IN THE RESOURCE FILE, which is the one place this pair
 *   differs from metric-server / notification-target. There is no `import type` cycle back as a
 *   result; ceph-pool.ts re-exports both interfaces so the public surface is unchanged.
 *
 * ⛔ POST AND PUT DO NOT TAKE THE SAME PARAMETERS, AND BOTH EXTRAS ARE DESTRUCTIVE. MEASURED from
 *   the cluster's own schema (/usr/share/pve-docs/api-viewer/apidoc.js on n2, pve-manager 9.2.11,
 *   2026-09-13): POST adds `add_storages` and `erasure-coding` to the shared set, PUT takes
 *   neither. Both are refused below, so what is left between the two bodies is `name`, which PUT
 *   reads from the path, and `pg_num`.
 *
 * ⛔ `pg_num` IS IN THE CREATE BODY AND NOT IN THE UPDATE BODY, AND THAT IS THE MOST IMPORTANT
 *   LINE IN THIS FILE. MEASURED in PVE::API2::Ceph::Pool::createpool on n2: a POST carrying no
 *   `pg_num` gets 128 substituted (`$param->{pg_num} //= 128`), and PVE::Ceph::Tools::create_pool
 *   then runs `osd pool create` — which Ceph answers with SUCCESS for a pool that already exists,
 *   before applying the rest of the body to it. So a create fired at a live pool SETS its pg_num,
 *   and lowering pg_num starts a PG MERGE: hours of backfill across every OSD, on a cluster whose
 *   Ceph traffic shares vmbr1.11 with everything else. ceph-pool.ts guards the create for exactly
 *   that reason; this half simply never offers pg_num to an update.
 */
import type { WithTarget } from './resource.ts';
import { csv } from './values.ts';

export interface CephPoolProps extends WithTarget {
  /**
   * ⚠️ WHICH NODE THE CALL GOES THROUGH, NOT WHERE THE POOL LIVES. A pool is cluster-wide: n2 and
   *   n3 answer byte-identically for `cephtb4` (measured). The endpoint is node-scoped only
   *   because PVE talks to the local RADOS socket, so this is a door, not a location — it is never
   *   compared, and moving a declaration from n2 to n3 plans noop. Point it at a node you expect
   *   to be up: a node that is down makes the read fail, and a failed read reads as "absent".
   */
  node: string;
  /**
   * Ceph's primary key, cluster-wide.
   * ⛔ CHANGING IT DOES NOT RENAME ANYTHING. There is no rename in this API: the plan reads the new
   *   name, finds nothing, and CREATES AN EMPTY POOL, leaving the old one and its data behind,
   *   untracked. `replace` was considered and rejected — it would DELETE the old pool and every
   *   image in it to satisfy an edited string. Rename by hand, deliberately, or not at all.
   */
  name: string;
  /** Replicas per object, 1-7. ⚠️ Frozen when the pool carries Ceph's `nosizechange`. */
  size?: number;
  /** Replicas required to accept writes, 1-7. ⚠️ Frozen by `nosizechange` too. */
  min_size?: number;
  /**
   * ⛔ CREATE-TIME ONLY, AND NEVER COMPARED — the single biggest noop hazard in this family. With
   *   `pg_autoscale_mode` on or warn the autoscaler owns this number: MEASURED on TB4, `cephtb4`
   *   sits at pg_num 128 while the autoscaler's own `pg_num_final` is 256, so a declaration
   *   diffing it reports an update the moment Ceph decides to act. A split is gradual even with
   *   the autoscaler off, and `nopgchange` can refuse the write outright — which kills the WHOLE
   *   PUT, not just this field. Declare it as the birth size; steer it afterwards with
   *   `pg_num_min`, or by hand.
   */
  pg_num?: number;
  /** The floor the autoscaler may not go below. Operator-owned and stable, so it IS compared. */
  pg_num_min?: number;
  /** ⚠️ PVE's create default is `warn`; Ceph's own is `on`, which is what all four TB4 pools have. */
  pg_autoscale_mode?: 'off' | 'on' | 'warn';
  /**
   * The CRUSH rule BY NAME, e.g. `replicated_rule`.
   * ★ THE SUSPECTED INTEGER-VS-NAME TRAP IS REAL BUT NOT ON THE PATH THIS RESOURCE READS, AND THAT
   *   IS MEASURED BOTH WAYS. `GET .../ceph/pool` (the collection) reports `crush_rule: 0` with the
   *   name beside it in `crush_rule_name`; `GET .../ceph/pool/{name}/status` reports
   *   `crush_rule: "replicated_rule"` — the same spelling POST and PUT accept. Reading the
   *   collection instead would reintroduce the forever-diff in a single edit.
   */
  crush_rule?: string;
  /**
   * ⛔ CREATE-TIME ONLY, AND NEVER COMPARED. PVE's PUT turns this into
   *   `osd pool application enable` (Tools.pm:250-255), which ADDS a tag and never removes one,
   *   and Ceph refuses a second application without `--yes-i-really-mean-it` — so an update would
   *   either leave the pool tagged twice or die, and comparing one declared string against the
   *   LIST that comes back is the set-in-arbitrary-order forever-diff. The live list is reported
   *   as `applications` instead.
   */
  application?: 'cephfs' | 'rbd' | 'rgw';
  /** Autoscaler size hint, ⚠️ IN BYTES — see the ⚠️ on `updateBody`. A `1T` string is not accepted. */
  target_size?: number;
  /**
   * Autoscaler share of total capacity, 0-1.
   * ⚠️ WRITTEN BUT NEVER DIFFED, because a float is not a safe equality: Ceph stores a double and
   *   PVE prints about 15 significant digits, so a ratio that is not exactly representable would
   *   report an update on every plan for a pool nobody touched.
   */
  target_size_ratio?: number;
  /**
   * ⛔ `never` ON PURPOSE, BOTH OF THEM, AND THE COMPILE ERROR IS THE FEATURE.
   *   `erasure-coding` does not configure this pool — it makes PVE build TWO pools and name
   *   neither of them what you declared: `<name>-data` for the EC data and `<name>-metadata` for
   *   the replicated half (Pool.pm:517-530). Nothing would then exist at `{name}`, so every plan
   *   would read absent and try to create it again, forever.
   *   `add_storages` writes a section into storage.cfg that this graph does not own; declare a
   *   `Proxmox.Storage` and pass this pool's `name` into it instead, which makes the link real.
   */
  'erasure-coding'?: never;
  add_storages?: never;
}

/**
 * ⚠️ THE THREE `no*` FLAGS ARE REPORTED BECAUSE THEY EXPLAIN A REFUSAL. Ceph can freeze a pool's
 *   size or its PG shape, and `set_pool` dies on the whole PUT when any one parameter will not
 *   apply (Tools.pm:310). `matches` refuses to diff the fields they freeze, so these attributes
 *   are the only place a plan can show WHY a declared size is not being enforced. All three read
 *   false on all four TB4 pools.
 * ⚠️ `pg_num`, `id` AND `applications` ARE REPORTED AND NEVER COMPARED — see the props above.
 * ⛔ NO `statistics` AND NO `autoscale_status`, though the verbose read returns both. They change
 *   every few seconds; persisting them would rewrite this resource's state on every deploy and
 *   read like drift. `UNSET` means the pool carries no value for that field.
 */
export interface CephPoolAttributes {
  name: string;
  /** The node the read went through. A debugging aid, not a property of the pool. */
  node: string;
  id: number;
  size: number;
  min_size: number;
  pg_num: number;
  pg_num_min: number;
  pg_autoscale_mode: string;
  /** ⚠️ Empty when PVE answered with a rule id instead of a name; `matches` then stops diffing it. */
  crush_rule: string;
  /** Sorted comma list, e.g. `rbd` or `cephfs`. Readable only under `?verbose=1`. */
  applications: string;
  target_size: number;
  target_size_ratio: number;
  nodelete: boolean;
  nopgchange: boolean;
  nosizechange: boolean;
}

/**
 * Where one pool is WRITTEN, and where a new one is POSTed.
 *
 * ⚠️ NEITHER IS WHERE IT IS READ — the read path is a segment longer and lives in ceph-pool.ts
 *   next to the ⛔ that explains it. These two are here because a path is wire knowledge, and
 *   because the create guard needs the collection without needing anything else from the spec.
 */
export const object = (props: CephPoolProps) => `nodes/${props.node}/ceph/pool/${props.name}`;
export const collection = (props: CephPoolProps) => `nodes/${props.node}/ceph/pool`;

/**
 * ⚠️ "NOT SET" IS -1 AND NOT 0, for the reason metric-server-form.ts gives: `pg_num_min`,
 *   `target_size` and `target_size_ratio` each take 0 as a REAL value meaning "no floor, no hint",
 *   so a provider using 0 as its absent-marker cannot tell a declared zero from an undeclared
 *   field. Every one of these is >= 0, so -1 sits outside all of their ranges.
 */
export const UNSET = -1;

/** ⚠️ PVE returns the tags as an ARRAY in Ceph's order, so `csv` sorts before anything sees them. */
export const applications = (value: unknown) =>
  csv(Array.isArray(value) ? value.map((entry: unknown) => String(entry)) : []);

/**
 * Declared? compare it. Undeclared, or frozen by a flag the pool carries? leave it alone.
 *
 * ⚠️ `frozen` IS THE WHOLE ANSWER TO "A FIELD PVE WILL NOT ACCEPT ON WRITE". Comparing one can only
 *   plan an update that no write can satisfy: work reported on every run, forever.
 */
export const same = <T>(declared: T | undefined, live: T, frozen = false) =>
  declared === undefined || frozen || declared === live;

/**
 * A declared autoscaler hint, or nothing when it is zero.
 *
 * ⚠️ A DECLARED ZERO IS "NO FLOOR, NO HINT", AND IT IS DELIBERATELY LEFT UNCOMPARED. REASONED, NOT
 *   MEASURED: all four TB4 pools carry null for both `pg_num_min` and `target_size`, and finding
 *   out for certain would mean writing to the cluster. Ceph CLEARS both when they are set to 0 and
 *   `osd pool get all` then omits the key, which PVE reports as null and this pair reads as UNSET
 *   — so a declared 0 would compare 0 against -1 on every plan, forever. Mapping 0 to UNSET
 *   instead would be a guess in the OTHER direction, and wrong the same way if Ceph does report
 *   the zero. Neither guess is made: a zero is still written, and then left unmanaged exactly like
 *   an undeclared field.
 */
export const hint = (value: number | undefined) => (value === 0 ? undefined : value);

/** One optional field, present in the form only when it was declared. */
const field = (name: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [name]: value };

/** ⚠️ Not named `digits`: `target_size_ratio` is a fraction, and `String` is right for both. */
const numeric = (value: number | undefined) => (value === undefined ? undefined : String(value));

/**
 * The PUT body: everything POST and PUT both accept, `pg_num` excepted. `createBody` builds on it,
 * the way storage.ts's `mutable` serves both of its forms. `name` is the path's last segment on an
 * update and is not repeated here.
 *
 * ⚠️ SAFE TO RE-APPLY TO A POOL THAT ALREADY MATCHES, which reconcile relies on. MEASURED in
 *   PVE::Ceph::Tools::set_pool (Tools.pm:293-300): it reads `osd pool get all` first and SKIPS
 *   every setting whose value did not change, so re-sending the declared set costs one mon read.
 * ⛔ BUT A SETTING THAT DID CHANGE AND CANNOT BE APPLIED KILLS THE WHOLE PUT. Tools.pm:310 dies
 *   with "Could not set: <fields>" if any parameter is left unapplied, so a pool carrying Ceph's
 *   `nosizechange` fails an entire update over one field. That is why the `no*` flags are reported
 *   and why `matches` refuses to diff what they freeze.
 *
 * ⚠️ AN UNDECLARED FIELD IS NEITHER SENT NOR COMPARED — storage.ts's rule, and the opposite of
 *   Proxmox.Pool's. Undeclared means UNMANAGED here, because a pool has no one set of defaults to
 *   fall back on: PVE's POST fills in size 3, min_size 2, application rbd and pg_autoscale_mode
 *   'warn' (MEASURED in createpool), while Ceph's own defaults — which is what every pool on TB4
 *   was actually born with — put pg_autoscale_mode at 'on'. Guessing either set would rewrite a
 *   pool somebody tuned by hand.
 *
 * ⛔ THERE IS NO `delete=` HERE AND THERE MUST NOT BE ONE. `setpool` is not a SectionConfig write:
 *   it turns each parameter into an `osd pool set`, and Ceph has no "unset" for size, min_size or
 *   crush_rule. metric-server-form.ts clears an undeclared optional because status.cfg supports
 *   it; the same move here would send a parameter PVE has no verb for.
 *
 * ⚠️ `target_size` IS BYTES ON THE WIRE IN BOTH DIRECTIONS, WHICH IS WHY THE PROP IS A NUMBER AND
 *   NOT PVE's `1T` STRING. MEASURED: the API parses the string with PVE::JSONSchema::parse_size
 *   and stores Ceph's `target_size_bytes` (Pool.pm:474-477 for POST, 683-686 for PUT), and
 *   `GET .../status` hands that integer back under the name `target_size` (Pool.pm:878). Run on
 *   n2, `parse_size('1099511627776')` returns 1099511627776 — bare digits are bytes, no
 *   multiplier — so a byte count survives the round trip exactly, while a declared `1T` would read
 *   back as 1099511627776 and diff against itself on every plan, forever.
 */
export const updateBody = (props: CephPoolProps): Record<string, string> => ({
  ...field('crush_rule', props.crush_rule),
  ...field('min_size', numeric(props.min_size)),
  ...field('pg_autoscale_mode', props.pg_autoscale_mode),
  ...field('pg_num_min', numeric(props.pg_num_min)),
  ...field('size', numeric(props.size)),
  ...field('target_size', numeric(props.target_size)),
  ...field('target_size_ratio', numeric(props.target_size_ratio)),
});

/**
 * The POST body.
 *
 * ⛔ `add_storages=0` IS SENT EXPLICITLY RATHER THAN LEFT OUT, AND THE DEFAULT IS NOT WHAT IT LOOKS
 *   LIKE. MEASURED at Pool.pm:481 — `$add_storages = 1 if $ec && !defined($add_storages)` — so for
 *   an erasure-coded pool PVE turns it ON when the parameter is absent. A pool created with it
 *   writes a NEW SECTION INTO storage.cfg that this graph does not own: `Proxmox.Storage` would
 *   not know about it, `alchemy destroy` would leave it behind, and the first person to notice
 *   would be whoever found a storage nobody declared.
 */
export const createBody = (props: CephPoolProps): Record<string, string> => ({
  ...updateBody(props),
  ...field('application', props.application),
  ...field('pg_num', numeric(props.pg_num)),
  add_storages: '0',
  name: props.name,
});
