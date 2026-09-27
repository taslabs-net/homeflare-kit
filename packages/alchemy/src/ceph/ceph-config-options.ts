/**
 * The named Ceph config-option list — the only options `ceph config get/set/rm` may ever touch
 * through the mon-command transport (ceph-argv.ts's `configProblem`). Design:
 * docs/plans/2026-09-26-ceph-config-options.md, D-C1.
 *
 * ⛔ THE LIST STARTS EMPTY, AND EACH ADDITION IS ITS OWN REVIEWED PR LINE. Nothing in K-A4 adds to
 *   it — `CephConfigOption` (K-D) is a separate, later family; this file exists now only so the
 *   transport's allowlist has something to bound `config` against from day one, per the accepted
 *   design ("config get/set for the named option list which starts EMPTY").
 * ⛔ NEVER ADD ONE OF THE LOCKOUT CLASSES BELOW. `mon_host`, `public_network`, `cluster_network`,
 *   `public_addr`, `cluster_addr`, every `auth_*_required` and every `key`/`keyring`-bearing
 *   option re-address the mons or de-authenticate the whole cluster — cutting every VM disk — and
 *   `isLockoutConfigOption` is a structural guard a test runs against this file's own list, not a
 *   suggestion for the reviewer of the next PR line.
 * ⛔ NEVER ADD A SECRET-VALUED OPTION. mgr module options can hold passwords (REASONED — no live
 *   cluster to measure this against yet); a secret-bearing setting belongs in a vault-backed flow,
 *   never a `ceph config set` argv, which lands in the runner's log and the node's sudo journal.
 */

/** Starts empty. Add one reviewed option name per PR line, never a batch. */
export const NAMED_CONFIG_OPTIONS: ReadonlySet<string> = new Set([]);

const LOCKOUT_EXACT: ReadonlySet<string> = new Set([
  'mon_host',
  'public_network',
  'cluster_network',
  'public_addr',
  'cluster_addr',
]);

/** `auth_*_required` (cephx enforcement) and anything key/keyring-shaped, either side of `_`. */
const LOCKOUT_PATTERN = /^auth_\w*_required$|(^|_)key(ring)?($|_)/;

/** Whether `name` is a class this transport must never read a value for, adopt, or write. */
export const isLockoutConfigOption = (name: string): boolean =>
  LOCKOUT_EXACT.has(name) || LOCKOUT_PATTERN.test(name);
