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
 *
 * ★ THE ORIGINAL DISTILLED WALK MOVED READ AND CREATE FIRST, leaving DELETE here because
 *   SDK flags were annotated as body fields. Distilled Proxmox 0.3.0 fixes their query binding
 *   and adds the measured CephFsNotFound tag. All calls now live in ceph-fs-distilled.ts;
 *   this file keeps the pure forms, attributes and read-back failure messages. The protocol
 *   history above remains load-bearing: moving a DELETE flag back into a body loses it silently.
 */
import type { CephFsAttributes, CephFsProps } from './ceph-fs.ts';
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

/**
 * ⚠️ SHORT POLLS, LOW CAP. Ninety seconds covers two pool creates plus the ten seconds `createfs`
 *   itself spends waiting for an MDS to go active, and is short enough that a stuck task fails the
 *   deploy rather than parking it for the afternoon.
 */
// ★ EXPORTED so ceph-fs-distilled.ts's OWN settle polls the same cadence and cap — one number.
export const POLL_SECONDS = 2;
export const POLL_ATTEMPTS = 45;

/** ⚠️ `nodes/{n}/ceph/fs/{name}` — the POST and DELETE target, and NOT where a read goes. */
export const objectPath = (props: CephFsProps) => `nodes/${props.node}/ceph/fs/${props.name}`;

/** The vendor rules `createForm` is checked against — `guardWrite`, distilled-guard.ts. */
export const CEPH_FS_CREATE = 'pve:POST /nodes/{node}/ceph/fs/{name}';

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
