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
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { readOsd } from './ceph-osd-tree.ts';
import type { CephOsdProps } from './ceph-osd.ts';
import { guardForm } from './constraint-guard.ts';
import type { EndpointKey } from './constraints.ts';
import { runPve } from './distilled-pve.ts';

/**
 * The vendor rules the create form is checked against at plan time.
 *
 * ⛔ DECLARED HERE RATHER THAN ON A SPEC BECAUSE THIS FAMILY HAS NO SPEC — `ceph-osd.ts` writes
 *   all five handlers by hand (the ⛔ there says why), so it cannot inherit the shared guard and
 *   would otherwise be the one family that writes to Ceph with nothing checking the body.
 * ⚠️ `dev` IS REQUIRED AND THE REFUSAL BELOW ALREADY COVERS IT, with a message about a missing
 *   replica that is far more useful than `dev: required`. The table is still worth checking: it
 *   also carries `db_dev_size` ≥ 1, `wal_dev_size` ≥ 0.5 and `osds-per-device` ≥ 1, and nothing
 *   else in this package knows those numbers.
 * ⚠️ THERE IS NO UPDATE KEY: PVE registers no PUT under `ceph/osd`, and an OSD is not editable.
 */
export const OSD_CREATE_ENDPOINT: EndpointKey = 'pve:POST /nodes/{node}/ceph/osd';

const describe = (props: CephOsdProps) => `osd.${String(props.osdid)} on ${props.node}`;

/**
 * The create body. ★ Exported so the constraint proof can run the REAL form.
 * ⚠️ `dev` is `string | undefined` on the props and non-optional here: `createOsd` refuses first.
 */
export const createOsdForm = (props: CephOsdProps, dev: string): Record<string, string> => ({
  dev,
  ...(props.device_class === undefined ? {} : { 'crush-device-class': props.device_class }),
});

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
  const form = createOsdForm(news, news.dev);
  // ⛔ BEFORE THE POST, BECAUSE THE POST ZAPS A BLOCK DEVICE. A vendor rule broken here is worth
  //   refusing at plan rather than discovering from a 400 after `ceph-volume` has run.
  yield* guardForm(OSD_CREATE_ENDPOINT, form, true);
  yield* runPve(
    news.target,
    'provision',
    true,
    nodes.createNodeCephOsd({
      dev: news.dev,
      node: news.node,
      ...(news.device_class === undefined ? {} : { crush_device_class: news.device_class }),
    }),
  );
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
 *
 * ⚠️ `cleanup` RIDES A DELETE BODY, ON `client.ts` AND ON DISTILLED ALIKE — PRE-EXISTING, NOT
 *   INTRODUCED HERE. `client.ts`'s own `buildRequest` (client.ts) puts `form` in the body for
 *   every method, DELETE included, and CHECKED against distilled's generated
 *   `DeleteNodeCephOsdRequest`: `cleanup` carries no `T.Query()` annotation either, so it also
 *   defaults to a body field. ceph-fs-wire.ts's own ⛔ (measured from PVE's `AnyEvent.pm`) is that
 *   PVE's server never reads a body on DELETE — so `cleanup=1` was ALREADY silently ignored by
 *   the live cluster before this migration, on the unmigrated code too. Migrating carries the
 *   SAME behaviour forward exactly, byte-for-byte, rather than introducing a new gap; unlike
 *   `Proxmox.CephFs`'s delete, this is not a reason to keep the call on the hand client. It has
 *   zero practical effect today regardless, since the whole DELETE 403s for this package's
 *   credential either way (the root-only ⛔ at the top of ceph-osd.ts) — flagged separately as a
 *   pre-existing, out-of-scope bug worth its own fix (move `cleanup` into the query string, the
 *   way `destroyPath` in ceph-fs-wire.ts already does).
 */
export const destroyOsd = (olds: CephOsdProps) =>
  runPve(
    olds.target,
    'provision',
    true,
    nodes.deleteNodeCephOsd({
      node: olds.node,
      osdid: String(olds.osdid),
      ...(olds.cleanup === true ? { cleanup: '1' } : {}),
    }),
  );
