/**
 * The two operations that change a disk: building an OSD and removing one.
 *
 * ★ SPLIT OUT OF ceph-osd.ts FOR THE 250-LINE CAP, and the seam is the honest one — this file is
 *   everything that WRITES, and ceph-osd.ts is the declaration and the assertion. A reader asking
 *   "can this destroy my data" has one file to read.
 *
 * ⛔ BOTH OF THESE ARE IRREVERSIBLE. `create` hands a block device to `ceph-volume lvm create`,
 *   which zaps it; `delete` takes a replica out of a live pool and Ceph immediately begins
 *   rewriting the missing copies across the remaining nodes. `Proxmox.CephOsd` therefore declares
 *   `defaultRemovalPolicy: 'retain'`, so removing a declaration does NOT reach `destroyOsd` — a
 *   caller opts in with `.pipe(RemovalPolicy.destroy())`.
 */
import * as Effect from 'effect/Effect';
import { readOsd } from './ceph-osd-tree.ts';
import type { CephOsdProps } from './ceph-osd.ts';
import { pve } from './client.ts';

const describe = (props: CephOsdProps) => `osd.${String(props.osdid)} on ${props.node}`;

export const createOsd = Effect.fn(function* (news: CephOsdProps) {
  if (news.dev === undefined) {
    return yield* Effect.die(
      new Error(
        `${describe(news)}: no such OSD in the CRUSH tree, and no \`dev\` was declared. ` +
          'Without a device this resource is an ASSERTION over an OSD that must already ' +
          'exist. Declare `dev` to let it create one -- which WIPES that device -- or fix ' +
          'the declaration; if the disk was there yesterday, a replica is missing and Ceph ' +
          'is degraded.',
      ),
    );
  }
  yield* pve(news.target, 'provision', 'POST', `nodes/${news.node}/ceph/osd`, {
    dev: news.dev,
    ...(news.device_class === undefined ? {} : { 'crush-device-class': news.device_class }),
  });
  const created = yield* readOsd(news);
  if (created === undefined) {
    return yield* Effect.die(
      new Error(
        `${describe(news)}: the create returned no error but osd.${String(news.osdid)} is ` +
          'still absent. Ceph allocates OSD ids and cannot be told which to use, so it most ' +
          'likely assigned a different number -- check `ceph osd tree`, and declare the id it ' +
          'actually gave the device rather than deploying again.',
      ),
    );
  }
  return created;
});

/**
 * ⛔ REMOVING THE DECLARATION REMOVES THE ASSERTION, NOT THE REPLICA, AND THAT ASYMMETRY IS THE
 *   POINT. `DELETE /nodes/{node}/ceph/osd/{osdid}` takes a replica out of a live pool — with
 *   `nobackfill`/`norecover` unset, Ceph immediately starts rewriting the missing copies across
 *   the two remaining nodes — and with `cleanup=1` it zaps the LVs as well. A stack file is
 *   edited by people in a hurry; a disk is not a thing a deleted line gets to destroy. Take an
 *   OSD out by hand, with the cluster healthy and `ceph -s` in front of you: `ceph osd out N`,
 *   wait for the backfill to finish, then `pveceph osd destroy N`.
 *
 * ★ SO IT IS IMPLEMENTED, AND THE RESOURCE DEFAULTS TO `retain` INSTEAD. Removing a declaration
 *   drops the state row and leaves the replica alone; a caller who really means it opts in with
 *   `.pipe(RemovalPolicy.destroy())`. That is the same shape Terraform gives `prevent_destroy`,
 *   and it beats a `delete` that silently does nothing — which is a lie to anyone reading the
 *   plan.
 *
 * ⚠️ `cleanup` DEFAULTS TO FALSE, so the logical volumes survive and the disk can be re-added
 *   without a rebuild. Ceph still starts backfilling the missing copies the moment the OSD goes.
 */
export const destroyOsd = (olds: CephOsdProps) =>
  pve(
    olds.target,
    'provision',
    'DELETE',
    `nodes/${olds.node}/ceph/osd/${String(olds.osdid)}`,
    olds.cleanup === true ? { cleanup: '1' } : {},
  );
