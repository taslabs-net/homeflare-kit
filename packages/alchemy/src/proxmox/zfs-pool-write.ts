/**
 * The create lane for `Proxmox.ZfsPool`: the form PVE wants, and the wait for the worker it forks.
 *
 * ★ SPLIT OUT OF zfs-pool.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is a real one
 *   rather than a convenient line number. This file answers "how does a declaration become a pool
 *   on disks, and how do we know it landed". zfs-pool.ts answers "what is a zpool, what can be
 *   said about a live one, and when has it changed" — and on this family the answer to the last of
 *   those is "never", which is why the two halves have so little to say to each other.
 *
 * ⚠️ THE `import type` BACK TO zfs-pool.ts IS A CYCLE ON PAPER ONLY — it is type-only, so it is
 *   erased before anything runs, and the resource's public shape stays in the file that declares
 *   the resource rather than being moved somewhere odd to dodge the arrow. Same as
 *   metric-server-form.ts.
 *
 * ⚠️ `createPool` TAKES THE READ AS A PARAMETER, GENERIC IN ITS ERROR AND REQUIREMENT CHANNELS,
 *   rather than importing `pveOperations` and rebuilding the spec here. Two `pveOperations` over
 *   one spec would be two closures nobody can prove are the same; passing the one the resource
 *   already built means this file cannot accidentally read the cluster differently from `diff`.
 */
import * as Effect from 'effect/Effect';
import { pve } from './client.ts';
import type { EndpointPair } from './resource-spec.ts';
import { text } from './values.ts';
import type { ZfsPoolAttributes, ZfsPoolProps } from './zfs-pool.ts';

/**
 * The POST body. Every field in it is write-only — nothing here is ever read back.
 *
 * ⚠️ `node` IS NOT IN THE BODY: it is already the `nodes/{node}` segment of the URL being POSTed
 *   to, and a second copy can only disagree with it. Same reasoning as `id` in metric-server.ts.
 * ⚠️ `devices` IS JOINED IN DECLARED ORDER AND NOT PUT THROUGH `csv()` FROM values.ts. `csv` sorts,
 *   and PVE walks this list two at a time to pair `raid10` mirrors — MEASURED in the node's own
 *   `PVE::API2::Disks::ZFS` — so sorting it builds a different pool from the one declared. The
 *   list is never compared against anything, so it needs no normalisation, only faithful order.
 * ⚠️ AN OMITTED OPTIONAL IS NOT SENT. PVE's own defaults (ashift 12, compression on) are then
 *   applied by the node. Sending a guessed default would be indistinguishable here — the values
 *   are unreadable afterwards either way — but it would put a number in the request that no
 *   declaration asked for, and this is the one call that writes to physical disks.
 */
/**
 * The vendor rules the create form is checked against at plan time.
 *
 * ⛔ HERE RATHER THAN INLINE IN zfs-pool.ts BECAUSE THAT FILE IS ALREADY OVER THE 250-LINE CAP,
 *   and a `pve:POST …` literal has to live in a non-test source file for the generator to table
 *   it at all. The spec imports it on the line it already imports `createForm` from.
 * ⚠️ NO UPDATE KEY: PVE registers no PUT under `/nodes/{node}/disks/zfs`, which is exactly why
 *   the spec declares no `updateForm` and a changed prop is a REPLACE.
 */
export const ZFS_POOL_ENDPOINT: EndpointPair = { create: 'pve:POST /nodes/{node}/disks/zfs' };

export const createForm = (props: ZfsPoolProps): Record<string, string> => ({
  devices: props.devices.join(','),
  name: props.name,
  raidlevel: props.raidlevel,
  ...(props.ashift === undefined ? {} : { ashift: String(props.ashift) }),
  ...(props.compression === undefined ? {} : { compression: props.compression }),
  ...(props['draid-config'] === undefined ? {} : { 'draid-config': props['draid-config'] }),
});

/** 30 reads, 2s apart. A create that has not landed in a minute has gone wrong, not gone slow. */
const SETTLE_ATTEMPTS = 30;

/**
 * Create the pool if it is absent, and otherwise leave it completely alone.
 *
 * ⛔ THE POST ONLY FORKS A WORKER. MEASURED in `/usr/share/perl5/PVE/API2/Disks/ZFS.pm` on node-b: the
 *   create handler ends in `$rpcenv->fork_worker('zfscreate', ...)` and its HTTP answer is a UPID
 *   returned the instant the worker is forked — before `zpool create` has run, let alone finished.
 *   A read-back taken immediately, as `pveOperations.reconcile` takes it, finds nothing and would
 *   report a successful create as the failure "the write returned no error but the object is still
 *   absent". THAT is why this function exists instead of the factory's reconcile.
 *
 * ⚠️ THERE IS NO UPDATE BRANCH BECAUSE PVE HAS NO PUT HERE. An existing pool is returned exactly as
 *   read, unwritten: the only write this resource ever makes is the create of a pool that is not
 *   there. Do not add a "repair" write; there is no field it could set.
 *
 * ⛔ AND IF THE READ IS WRONG, THE POST IS STILL SAFE — measured, not hoped for. `read` folds a 403
 *   or an unreachable node into "absent", so a too-narrow lease would send this down the create
 *   path over a live pool. PVE's handler calls `get_pool_data()` before it forks anything and dies
 *   with "pool '<name>' already exists on node '<node>'", and `assert_disk_unused` refuses every
 *   device that pool is holding. A create aimed at a pool that is really there fails loudly rather
 *   than wiping it.
 *
 * ⚠️ SHORT POLLS WITH A HARD CAP, NOT ONE LONG WAIT. `read` cannot tell "not yet" from "forbidden"
 *   — both are `undefined` — so the loop gives up with the UPID rather than retrying forever, and
 *   the UPID is the only thing that leads to the worker's real error.
 */
export const createPool = <E, R>(
  props: ZfsPoolProps,
  collection: string,
  path: string,
  read: (props: ZfsPoolProps) => Effect.Effect<ZfsPoolAttributes | undefined, E, R>,
) =>
  Effect.gen(function* () {
    const existing = yield* read(props);
    if (existing !== undefined) return existing;

    const upid = yield* pve<string>(
      props.target,
      'provision',
      'POST',
      collection,
      createForm(props),
    );

    const settle = (attempts: number): Effect.Effect<ZfsPoolAttributes | undefined, E, R> =>
      Effect.gen(function* () {
        const live = yield* read(props);
        if (live !== undefined || attempts <= 0) return live;
        yield* Effect.sleep('2 seconds');
        return yield* settle(attempts - 1);
      });

    const after = yield* settle(SETTLE_ATTEMPTS);
    if (after === undefined) {
      return yield* Effect.die(
        new Error(
          `${path}: POST returned ${text(upid, '(no UPID)')} but the pool has not appeared. That ` +
            'POST only forks a `zfscreate` worker, so the task holds the real error -- read it ' +
            `with \`pvesh get /nodes/${props.node}/tasks/<upid>/log\`. NOTHING WAS RETRIED AND ` +
            'NOTHING WAS CLEANED UP: if the worker reached `zpool create`, the declared devices ' +
            'have already been written to.',
        ),
      );
    }
    return after;
  });

/**
 * ⛔ `DELETE /nodes/{node}/disks/zfs/{name}` RUNS `zpool destroy` AND THE DATASETS GO WITH IT.
 *   It is implemented rather than stubbed, because a `delete` that silently does nothing lies to
 *   whoever reads the plan. What keeps a deleted line from destroying a pool is the resource's
 *   `defaultRemovalPolicy: 'retain'` above — an orphaned pool is forgotten, not destroyed, and a
 *   caller who means it says `.pipe(RemovalPolicy.destroy())`.
 *
 * ⚠️ `cleanup-config` IS NOT SENT. It would additionally remove the PVE storage entry pointing
 *   at this pool, which is a different object with its own resource (`Proxmox.Storage`); one
 *   resource reaching over to delete another's is how a stack ends up with state describing
 *   something that is gone.
 */
export const destroyPool = (olds: ZfsPoolProps, path: string) =>
  pve(olds.target, 'provision', 'DELETE', path);
