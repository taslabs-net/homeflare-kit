/**
 * Flag names, props and attributes for `Proxmox.CephFlag`.
 *
 * ★ SPLIT OUT OF ceph-flag.ts FOR THE 250-LINE CAP. The comments stay with the types they
 *   explain; nothing here talks to the cluster.
 */
import type { WithTarget } from './resource-spec.ts';

/**
 * PVE's eleven flags, spelled as `PVE::Ceph::Tools::get_possible_osd_flags` spells them.
 *
 * ⚠️ THE ENUM IS CLOSED AND A TYPO IS A 400, WHICH IS WHY THIS IS A UNION AND NOT `string`. Both
 *   the GET and the PUT declare `additionalProperties => 0` over exactly this list.
 * ⚠️ CEPH HAS FLAGS PVE DOES NOT MODEL, and four of them are always on. MEASURED on C1:
 *   `ceph osd dump` reports `flags sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit`.
 *   PVE reads that same string and answers only about its own eleven, so the others can neither
 *   leak in here nor be set from here — `noautoscale` and `nosnaptrim` included.
 *   ⛔ IF SOMEBODY LATER "IMPROVES" THE READ BY PARSING `osd dump` DIRECTLY, those four become
 *     permanently-set flags that nothing declares: a forever-diff on a brand new cluster.
 */
export type CephFlagName =
  | 'nobackfill'
  | 'nodeep-scrub'
  | 'nodown'
  | 'noin'
  | 'noout'
  | 'norebalance'
  | 'norecover'
  | 'noscrub'
  | 'notieragent'
  | 'noup'
  | 'pause';

export interface CephFlagProps extends WithTarget {
  /**
   * Which flag. PVE's primary key here, and the last segment of the path.
   *
   * ⚠️ EDITING IT IN PLACE ORPHANS THE OLD FLAG RATHER THAN MOVING ANYTHING. `diff` reads the NEW
   *   path and reconcile writes it, while the old flag keeps whatever this stack last put there.
   *   There is deliberately no replace override for it — acl.ts needs one because its `delete`
   *   removes a real grant, and `delete` here is inert by design, so a replace would do exactly
   *   what an update already does. Declare a second resource and set the old one to `value: false`
   *   rather than renaming this one.
   * ⛔ TWO RESOURCES DECLARING THE SAME FLAG ARE ONE CLUSTER OBJECT, and Alchemy sees two ids
   *   rather than a collision — the acl.ts hazard exactly. Disagreeing, they take turns winning
   *   and BOTH plan `update` for ever; agreeing, deleting either leaves the flag where the other
   *   put it. One declaration per flag per cluster.
   */
  flag: CephFlagName;
  /**
   * Set the flag (`true`) or clear it (`false`).
   *
   * ⛔ REQUIRED, WITH NO DEFAULT — see the second ⛔ in the header, which is the whole safety
   *   argument for this family. It is also the only field PVE accepts on this endpoint, and it is
   *   not optional in the schema either: omitting it from the form is a 400, not an untouched
   *   flag. (The BULK endpoint is the one where omission means "leave it alone"; this is not it.)
   */
  value: boolean;
}

export interface CephFlagAttributes {
  /**
   * ⚠️ REPORTED, NEVER COMPARED. It is the path key the read was made WITH, copied back out of
   *   props, so comparing it against props would be true by construction — the same reasoning
   *   acl.ts gives for the four identity fields it also declines to diff.
   */
  flag: CephFlagName;
  /** Whether ceph has the flag set right now. The only field `matches` looks at. */
  value: boolean;
}
