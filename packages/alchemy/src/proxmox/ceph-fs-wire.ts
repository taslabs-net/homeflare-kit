/**
 * The wire lane of `Proxmox.CephFs`: how a PVE answer becomes attributes, how a declaration becomes
 * a PVE call, and how that call becomes a fact.
 *
 * ★ SPLIT OUT OF ceph-fs.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is a real one
 *   rather than a convenient line number. ceph-fs.ts answers "what is a CephFS, and when has it
 *   changed"; this file answers "what does PVE say, what does it want, and has it finished". On
 *   this family that is where all the strangeness lives — the read is an index and not an object,
 *   the paths are inverted, the delete takes its arguments in the query string, and both writes
 *   fork a worker — so keeping it in one place is what stops the next reader assuming the ordinary
 *   shape from the other nineteen resources. ⚠️ NOTHING HERE DECIDES A DIFF.
 *
 * ⚠️ THE `import type` BACK TO ceph-fs.ts IS A CYCLE ON PAPER ONLY. It is type-only and erased
 *   before anything runs, exactly as metric-server-form.ts imports `MetricServerProps`. The props
 *   stay the resource's public shape, declared in the file that declares the resource.
 *
 * ⛔ POST AND DELETE ANSWER WITH A UPID, NOT A RESULT — THE WRITE IS ASYNCHRONOUS AND A FAILED ONE
 *   IS STILL HTTP 200. Read from the cluster's own source, /usr/share/perl5/PVE/API2/Ceph/FS.pm on
 *   node-b: `createfs` and `destroyfs` both end `return $rpcenv->fork_worker(...)`. Two different lies
 *   come out of trusting that status code. A read-back straight after the POST reports "still
 *   absent" about a filesystem that is being built as it says so — which is precisely the message
 *   `pveOperations.reconcile` would print, pointing at the wrong cause. And a worker that dies
 *   INSIDE — the pool create, or the add-storage step, both of which are wrapped in `eval` — is
 *   never reported to the caller at all. `settle` below is the answer to both.
 *   ⚠️ REASONED FROM THAT SOURCE, NOT MEASURED. Nothing was written to this cluster, so the race
 *     has not been observed; only the `fork_worker` that guarantees it is there.
 *
 * ⛔ A DELETE BODY IS SILENTLY DISCARDED BY PVE, SO `remove-pools` GOES IN THE QUERY STRING.
 *   MEASURED in /usr/share/perl5/PVE/APIServer/AnyEvent.pm on node-b: line 928 reads the request
 *   content into params only `if ($method eq 'PUT' || $method eq 'POST')`, and line 1653 sends
 *   every other method down a branch that parses `$request->url->query()` and nothing else. So
 *   `pve(target, role, 'DELETE', path, form)` would send a body PVE never looks at: the flags would
 *   read as unset, the pools would quietly survive a delete that asked for them, and no error would
 *   be raised anywhere. sdn-apply.ts already puts `?pending=1` in the path for the same reason.
 *
 * ⚠️ THE TASK POLL RUNS ON THE `read` ROLE THOUGH IT SITS INSIDE reconcile, FOR TWO REASONS. It is
 *   a read, and resource.ts already mints `read` for its own read-back inside reconcile. And the
 *   leases differ where it matters: `provision` is 300s and explicitly non-renewable, so a create
 *   that waits out a slow worker on that lease can expire mid-poll, while `read` is 3600s.
 *
 * ⛔ THE POLLER IS NEVER THE TASK'S OWNER, WHICH COSTS A PRIVILEGE, AND THIS ONE IS MEASURED
 *   RATHER THAN FEARED. client.ts mints a fresh credential per call and the mount vends a NEW
 *   token id each time, so the token reading the status is never the token recorded in the UPID —
 *   and PVE compares them exactly. /usr/share/perl5/PVE/API2/Tasks.pm on node-b, `$check_task_user`:
 *   `return $user eq $fulltoken || $user eq $task->{user};`, above it the comment "token only sees
 *   token tasks, user sees user + token tasks". Token B of the same user matches neither branch.
 *   So the fallback is the schema's other clause for `GET /nodes/{node}/tasks/{upid}/status`: "The
 *   user needs 'Sys.Audit' permissions on '/nodes/<node>' if they are not the owner of the task."
 *   Grant it on the `read` role, or every create burns the full cap below and reports the wrong
 *   cause.
 */
import * as Effect from 'effect/Effect';
import type { CephFsAttributes, CephFsProps } from './ceph-fs.ts';
import { pve } from './client.ts';
import type { PveTarget } from './credentials.ts';
import { csv, flag, int, text } from './values.ts';

/**
 * This filesystem's row of the index, as attributes.
 *
 * ⚠️ `GET /nodes/{node}/ceph/fs` ANSWERS AN ARRAY, while the factory hands `attributes` the
 *   `Record<string, unknown>` every other PVE read is shaped like. Rows are narrowed rather than
 *   trusted, the same way acl.ts narrows its one flat grant list.
 *
 * ⛔ RETURNING undefined IS WHAT MAKES "ABSENT" MEAN ABSENT HERE, unlike acl.ts where the object is
 *   always present-but-unbound. A filesystem missing from the index has not been created, and
 *   `reconcile` takes the create branch on exactly that signal.
 */
export const readRow = (
  live: Record<string, unknown>,
  props: CephFsProps,
): CephFsAttributes | undefined => {
  const row = (Array.isArray(live) ? live : [])
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .find((entry) => entry['name'] === props.name);
  if (row === undefined) return undefined;
  return {
    data_pool: text(row['data_pool']),
    data_pools: csv(
      Array.isArray(row['data_pools'])
        ? row['data_pools'].map((entry: unknown) => String(entry))
        : [],
    ),
    metadata_pool: text(row['metadata_pool']),
    metadata_pool_id: int(row['metadata_pool_id'], -1),
    name: props.name,
  };
};

/** ⚠️ `exitstatus` is ABSENT while a task runs, and is the exact string `OK` only on success. */
type TaskStatus = { readonly status?: string; readonly exitstatus?: string };

/**
 * ⚠️ SHORT POLLS, LOW CAP. Ninety seconds covers two pool creates plus the ten seconds `createfs`
 *   itself spends waiting for an MDS to go active, and is short enough that a stuck task fails the
 *   deploy rather than parking it for the afternoon.
 */
const POLL_SECONDS = 2;
const POLL_ATTEMPTS = 45;

/** ⚠️ `nodes/{n}/ceph/fs/{name}` — the POST and DELETE target, and NOT where a read goes. */
export const objectPath = (props: CephFsProps) => `nodes/${props.node}/ceph/fs/${props.name}`;

/** Only the declared flags. ⚠️ An omitted one is PVE's own default, not a value to send. */
const field = (name: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [name]: value };

/**
 * ⚠️ `name` IS DELIBERATELY ABSENT FROM THE FORM. It is already the last segment of the path being
 *   POSTed to — the metric-server.ts case again — and a second copy can only ever disagree with it.
 */
export const createForm = (props: CephFsProps): Record<string, string> => ({
  ...field('add-storage', flag(props['add-storage'])),
  ...field('pg_num', props.pg_num === undefined ? undefined : String(props.pg_num)),
});

/** The delete target with its flags in the query string — see the ⛔ in the header. */
const destroyPath = (props: CephFsProps) => {
  const query = [
    props['remove-pools'] === true ? 'remove-pools=1' : undefined,
    props['remove-storages'] === true ? 'remove-storages=1' : undefined,
  ].filter((part) => part !== undefined);
  return query.length === 0 ? objectPath(props) : `${objectPath(props)}?${query.join('&')}`;
};

/**
 * Wait for a forked PVE task, and fail loudly rather than quietly.
 *
 * ⚠️ THE UPID IS PERCENT-ENCODED BECAUSE IT IS FULL OF COLONS — `UPID:node-b:00396D3A:…:root@pam:`
 *   (MEASURED shape, from `GET /nodes/node-b/tasks`) is ONE path segment, not seven. Encoding is what
 *   guarantees it arrives as one; PVE's router decodes each segment before matching. REASONED from
 *   the URI handling rather than measured — no task of this provider's has been polled yet.
 */
const settle = (target: PveTarget, node: string, upid: string, what: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      const status = yield* pve<TaskStatus>(
        target,
        'read',
        'GET',
        `nodes/${node}/tasks/${encodeURIComponent(upid)}/status`,
      ).pipe(
        // ⚠️ AN UNREADABLE STATUS IS "NOT SETTLED YET", NOT A FAILURE. It is a missing Sys.Audit
        //   (see the header) or a node mid-restart; either way the task is still the cluster's
        //   business, and the cap is what ends the wait rather than one unlucky GET.
        Effect.orElseSucceed(() => undefined),
      );
      if (status?.status === 'stopped') {
        const exit = text(status.exitstatus);
        if (exit === 'OK') return;
        return yield* Effect.die(
          new Error(
            `${what}: PVE task ${upid} finished with "${exit === '' ? 'no exit status' : exit}". ` +
              'The write returned HTTP 200 because it only forked the worker -- the real error is ' +
              `in \`pvesh get /nodes/${node}/tasks/${upid}/log\`.`,
          ),
        );
      }
      // ⚠️ A BARE NUMBER IS MILLISECONDS to Effect's Duration, not seconds. The cap in the
      //   message below is derived from the same constant so the two cannot drift apart.
      yield* Effect.sleep(POLL_SECONDS * 1000);
    }
    return yield* Effect.die(
      new Error(
        `${what}: PVE task ${upid} was still running after ` +
          `${String(POLL_ATTEMPTS * POLL_SECONDS)}s, or its ` +
          'status could not be read. Check the task log, and check that the `read` role holds ' +
          `Sys.Audit on /nodes/${node} -- each call mints a new token, so the poller is never the ` +
          'task owner and is answered 403 rather than told to wait.',
      ),
    );
  });

/**
 * POST the create, then wait for the worker. ⛔ The caller still reads back; see ceph-fs.ts.
 *
 * ⚠️ A CREATE NEEDS A RUNNING *AND* A STANDBY MDS, and refuses BEFORE it forks -- "no running
 *   Metadata Server (MDS) found!" / "no standby Metadata Server (MDS) found!" are synchronous, so
 *   they surface as a failed POST rather than as a silent worker. C1 has three (MEASURED: node-c
 *   `up:active` for cephfs-c1, node-b and node-d `up:standby`), so this is a note for a smaller cluster.
 * ⚠️ BOTH WRITES CHECK `Sys.Modify` ON `/` -- the root, with the breadth metric-server.ts warns
 *   about: granting it buys datacenter options and every other cluster-wide config write too.
 */
export const createFs = (props: CephFsProps) =>
  Effect.gen(function* () {
    const upid = text(
      yield* pve<string>(props.target, 'provision', 'POST', objectPath(props), createForm(props)),
    );
    // ⛔ NO UPID MEANS NO WORKER. PVE answers 200 with `{"data":null}` on calls that did nothing,
    //   and here that is indistinguishable from success by status code alone. Refusing now is the
    //   difference between a clear failure and a state entry for a filesystem nobody built.
    if (upid === '') {
      return yield* Effect.die(
        new Error(
          `${objectPath(props)}: POST returned no task id. PVE wraps every answer in ` +
            '{"data":...} and can report success on a call that did nothing.',
        ),
      );
    }
    yield* settle(props.target, props.node, upid, objectPath(props));
  });

/**
 * DELETE the filesystem, then wait for the worker.
 *
 * ⛔ WHAT THIS TAKES AWAY DEPENDS ENTIRELY ON `remove-pools`, AND THE DEFAULT IS THE SAFE ONE. With
 *   it unset PVE removes the filesystem from the MDS map and LEAVES the two pools on disk: every
 *   mount breaks, but the bytes are still there for an operator to recover. With it set the pools
 *   go too and nothing is recoverable. Leaving it unset also means a later create of the SAME name
 *   fails with "ceph pools '<name>_data' and/or '<name>_metadata' already exist" -- that refusal is
 *   a BRAKE, not a bug, and it is the last thing standing between a mis-typed rename and the data.
 */
export const destroyFs = (props: CephFsProps) =>
  Effect.gen(function* () {
    const upid = text(yield* pve<string>(props.target, 'provision', 'DELETE', destroyPath(props)));
    // ⚠️ A DESTROY THAT ANSWERS WITHOUT A UPID IS NOT REFUSED HERE. `destroyfs` dies synchronously
    //   with "no such cephfs" when the filesystem is already gone, which surfaces as a failed
    //   DELETE; an empty answer that is not an error is best treated as already-absent, and the
    //   caller's read-back is what proves it either way.
    if (upid !== '') yield* settle(props.target, props.node, upid, destroyPath(props));
  });

/**
 * The two read-back failures, as messages rather than as guesses.
 *
 * ⛔ WAITING PROVES THE TASK ENDED; ONLY A READ PROVES THE FILESYSTEM DID OR DID NOT. `createfs`
 *   wraps its pool creates in an `eval` and CLEANS THEM UP on error before dying, so a worker can
 *   plausibly end having built and then removed everything it made. `destroyfs` refuses outright
 *   while a non-disabled `cephfs` storage still references the filesystem. Neither outcome is
 *   visible in a status code, which is why ceph-fs.ts reads back after both and dies with these.
 */
export const notCreated = (props: CephFsProps) =>
  new Error(
    `${objectPath(props)}: the create task finished but the filesystem is not in ` +
      `GET nodes/${props.node}/ceph/fs. Check the task log -- a PVE worker can exit having ` +
      'rolled back the pools it had just made.',
  );

export const notDestroyed = (props: CephFsProps) =>
  new Error(
    `${objectPath(props)}: the destroy task finished but the filesystem is still in ` +
      `GET nodes/${props.node}/ceph/fs. PVE refuses to destroy a CephFS while a PVE storage entry ` +
      'of type cephfs still references it and is not disabled.',
  );
