/**
 * A prune job's wire half — and, deliberately, EVERY LINE THAT CAN DELETE A BACKUP.
 *
 * ★ SPLIT OUT OF pbs-prune-job.ts ON THE SEAM replication-job-form.ts USES: that file answers
 *   "what is a prune job and when has it changed", this one answers "how does a declaration become
 *   a PBS write". The one deliberate departure from that seam is `keepsMatch`, which is diff logic
 *   and lives here anyway — see the ★ below, which is the reason the cut falls where it does.
 *
 * ★ THE SIX RETENTION WINDOWS ARE TOUCHED IN THREE PLACES AND ALL THREE ARE IN THIS FILE: sent by
 *   `keepForm`, read back by `keepAttributes`, compared by `keepsMatch`. The three must stay in
 *   step — a window written but not compared is a diff that never settles, and one compared but not
 *   written is an update reported on every plan forever — and this is the half of the resource
 *   where being wrong costs backups rather than a confusing plan. Keeping all three on one screen
 *   is what makes that review possible in one sitting instead of a grep across two files.
 *
 * ⚠️ THE `import type` BACK TO pbs-prune-job.ts IS A CYCLE ON PAPER ONLY. It is type-only, erased
 *   before anything runs, so `PruneJobProps` stays the resource's public shape in the file that
 *   declares the resource rather than being moved somewhere odd to dodge the arrow.
 *
 * ⚠️ FORM ENCODING IS THE ONE TRANSPORT ASSUMPTION THIS FAMILY RESTS ON, AND IT IS REASONED RATHER
 *   THAN MEASURED. `pveWith` sends `application/x-www-form-urlencoded`; PBS's REST server accepts
 *   that alongside JSON and parses each value through the parameter schema, which is how its own
 *   ExtJS GUI talks to it. I could not prove it: there is no credential for this host (see the ⛔ in
 *   pbs-prune-job.ts) and the only unauthenticated endpoint that would have distinguished a 400
 *   "bad parameters" from a 401 is the login form, which is not a thing to poke on a live box. If
 *   PBS turns out to want JSON here, every key and value below is still right and only the
 *   transport is wrong — VERIFY THIS FIRST, before anything else in these two files.
 */
import type { PruneJobAttributes, PruneJobProps } from './pbs-prune-job.ts';
import { flag, int } from './values.ts';

/**
 * The six retention windows, in PBS's own spelling.
 *
 * ⚠️ ONE LIST, READ THREE TIMES — by `keepForm` on the way to the wire, by `keepsMatch` on the way
 *   back, and by `keepsSomething` in the guard. Two hand-kept copies of six key names is how a
 *   seventh window gets added to one of them and silently never sent, which for this family means
 *   never applied and never noticed until a restore.
 */
export const KEEP_KEYS = [
  'keep-last',
  'keep-hourly',
  'keep-daily',
  'keep-weekly',
  'keep-monthly',
  'keep-yearly',
] as const;

export type KeepKey = (typeof KEEP_KEYS)[number];

/** ⚠️ Undeclared windows are simply absent — see `requireKeeps` for why zero is never sent. */
const keepForm = (props: PruneJobProps): Record<string, string> => {
  const form: Record<string, string> = {};
  for (const key of KEEP_KEYS) {
    const value = props[key];
    if (value !== undefined) form[key] = String(value);
  }
  return form;
};

/**
 * The six windows off the wire, where `0` MEANS ABSENT.
 *
 * ⛔ ZERO IS A SENTINEL HERE AND CAN NEVER BE A LIVE VALUE, which is the only reason it is safe to
 *   use one. MEASURED from the published PBS schema: every `keep-*` carries `minimum: 1`, so PBS
 *   cannot store a zero and cannot be sent one — `keep-daily=0` is a 400, not a wipe. A field that
 *   comes back missing is a window that is not part of this job's policy, and `keepsMatch` must be
 *   able to tell that apart from "the declaration asked for zero", which it cannot express either.
 */
export const keepAttributes = (
  live: Record<string, unknown>,
): Pick<PruneJobAttributes, KeepKey> => ({
  'keep-daily': int(live['keep-daily'], 0),
  'keep-hourly': int(live['keep-hourly'], 0),
  'keep-last': int(live['keep-last'], 0),
  'keep-monthly': int(live['keep-monthly'], 0),
  'keep-weekly': int(live['keep-weekly'], 0),
  'keep-yearly': int(live['keep-yearly'], 0),
});

/**
 * ⚠️ AN UNDECLARED WINDOW IS NOT COMPARED, AND THAT IS THE SAFETY MODEL RATHER THAN AN OVERSIGHT.
 *   A `keep-weekly` an operator set by hand on an adopted job is not drift this stack repairs —
 *   repairing it would mean narrowing retention nobody asked to narrow. The cost is stated rather
 *   than hidden: deleting a `keep-daily` line from a declaration plans as a NOOP and changes
 *   nothing on the server. See the ⛔ on `updateBody` for why clearing is a hand operation.
 */
export const keepsMatch = (attributes: Pick<PruneJobAttributes, KeepKey>, props: PruneJobProps) =>
  KEEP_KEYS.every((key) => props[key] === undefined || props[key] === attributes[key]);

/**
 * ⛔ A PRUNE JOB WITH NO `keep-*` KEEPS NOTHING, AND THIS REFUSES TO BUILD ONE.
 *
 *   MEASURED from the published PBS API: all six windows are `optional: 1` on POST and on PUT. So
 *   on the wire "I forgot the retention" and "I want no retention" are the SAME REQUEST, and the
 *   second one is not a configuration — it is a scheduled deletion of every backup in scope. This
 *   is the one mistake this family must not be able to make.
 *
 * ⚠️ PBS PROBABLY REFUSES IT TOO, AND THAT IS NOT GOOD ENOUGH TO LEAN ON. Its GUI warns about a
 *   keep-less prune job, which suggests the API guards it as well, but I could not reach a PBS to
 *   prove it and "probably refused upstream" is not a thing to bet a restore on. The guard is
 *   local, it is cheap, and it costs nothing at all on a declaration that is already correct.
 *
 * ⛔ IT THROWS RATHER THAN RETURNING AN EMPTY FORM. `reconcile` calls these builders inside
 *   `Effect.gen`, so the throw lands as a defect and stops the deploy carrying this sentence. A
 *   builder that quietly answered `{}` instead would be a PUT of nothing — reported as success —
 *   over the retention the declaration existed to set.
 *
 * ⚠️ IT FIRES AT DEPLOY, NOT AT PLAN, because `diff` never calls a form builder: a keep-less
 *   declaration plans as a clean create and then dies on apply. Loud and safe, but not early. The
 *   stronger guard is a props type where one window is mandatory — a `Base & ({'keep-last': number}
 *   | …)` union — and it is NOT here because I could not satisfy myself that Alchemy's
 *   `Input<Props>` narrowing distributes over that union, and an unverified type trick in the file
 *   that decides what gets deleted is worse than an honest runtime throw.
 */
const keepsSomething = (props: PruneJobProps) => KEEP_KEYS.some((key) => props[key] !== undefined);

const requireKeeps = (props: PruneJobProps) => {
  if (keepsSomething(props)) return;
  throw new Error(
    `Pbs.PruneJob ${props.id}: declares no keep-* window, which tells PBS to keep NOTHING on ` +
      `datastore '${props.store}'. Every keep-* is optional on the wire, so an omission and a ` +
      'deliberate "retain nothing" are indistinguishable; declare at least one window (keep-last, ' +
      'keep-hourly, keep-daily, keep-weekly, keep-monthly or keep-yearly) or delete the job.',
  );
};

/** ⚠️ An undeclared field emits NO KEY AT ALL, not an empty one — see the ⚠️ on `shape`. */
const field = (name: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [name]: value };

/** ⚠️ `undefined` in, `undefined` out, so `field` can drop it — never the text "undefined". */
const integer = (value: number | undefined) => (value === undefined ? undefined : String(value));

/**
 * The mutable half, shared by create and update.
 *
 * ⚠️ `store` AND `schedule` ARE ALWAYS SENT because they are always declared and always compared —
 *   a field compared against a value but NOT SENT as that value is an update reported on every
 *   plan that the PUT never performs (backup-job.ts and replication-job-form.ts both record that
 *   trade). PBS makes both required on POST and optional on PUT, so sending them on both calls is
 *   legal and keeps one shape for the two.
 *
 * ⚠️ EVERYTHING ELSE IS SENT ONLY WHEN DECLARED, AND UNDECLARED MEANS UNMANAGED — the rule
 *   storage.ts sets, not backup-job.ts's "always send the documented default". The difference is
 *   what the drift costs: an undetected `enabled 0` on a vzdump job means backups quietly are not
 *   happening, while an unasked-for change here means backups quietly ARE being deleted. Writing a
 *   default this stack never declared is the worse error for a destructive job, so it is not done.
 *   ⛔ `max-depth` IS THE EXCEPTION THAT PROVES IT AND IT RUNS THE OTHER WAY — see the ⛔ in
 *     pbs-prune-job.ts. Its unset value is FULL RECURSION, so leaving it unmanaged is the WIDE
 *     choice rather than the narrow one. Declare it.
 */
const shape = (props: PruneJobProps): Record<string, string> => ({
  ...keepForm(props),
  ...field('comment', props.comment),
  ...field('disable', flag(props.disable)),
  ...field('max-depth', integer(props['max-depth'])),
  ...field('ns', props.ns),
  schedule: props.schedule,
  store: props.store,
});

/**
 * ⛔ `id` IS SENT AND IS NOT OPTIONAL, for backup-job.ts's reason sharpened by this API's shape.
 *   MEASURED: `id` is a REQUIRED parameter of `POST /config/prune` — PBS does not generate one —
 *   so an omitted id is a 400 rather than a duplicate job. That is the good case; the bad one is
 *   the id being WRONG. `pveOperations.read` folds every failed GET into "absent", so a 403 or an
 *   expired lease reads as "no such job", the plan says create, and a second prune job appears
 *   beside the first with this declaration's retention applied to the same datastore. Two prune
 *   jobs on one store do not negotiate: each deletes what its own windows do not keep.
 */
export const createBody = (props: PruneJobProps): Record<string, string> => {
  requireKeeps(props);
  return { ...shape(props), id: props.id };
};

/**
 * ⛔ THERE IS NO `delete` LIST HERE AND `withClears()` IS DELIBERATELY NOT IMPORTED. Two
 *   independent reasons, either of which alone would be enough.
 *
 *   FIRST, THE WIRE SHAPE IS NOT PVE'S. MEASURED from the published PBS schema, `PUT
 *   /config/prune/{id}` declares `delete` as `{"type":"array","items":{"type":"string","enum":[
 *   "comment","disable","ns","max-depth","keep-last","keep-hourly","keep-daily","keep-weekly",
 *   "keep-monthly","keep-yearly"]}}` — an ARRAY of enum members. PVE's `delete` is a comma-joined
 *   string, which is exactly what `withClears()` builds, and a form-encoded array is built by
 *   REPEATING the key. `delete=comment,disable` is therefore ONE item that is in no enum: a 400,
 *   not a clear.
 *   ⚠️ AND THE CORRECT SHAPE IS NOT EXPRESSIBLE TODAY. `pveWith` takes `Record<string, string>` and
 *     runs it through `new URLSearchParams`, which cannot repeat a key from a plain object. A PBS
 *     clear list needs a client that can, and that is a change to client.ts rather than to this
 *     file — so a clear list could not be shipped here even if it were wanted.
 *
 *   SECOND, AND THIS ONE WOULD STAND ANYWAY: CLEARING A `keep-*` IS THE MOST DESTRUCTIVE THING
 *   THIS API CAN DO. Removing `keep-last` from a job that had it does not restore a default — PBS
 *   has no default retention — it NARROWS what survives the next run. So an undeclared field is
 *   unmanaged, and a window this stack never mentioned is one it never widens and never removes.
 *   Dropping a `keep-daily` line from a declaration therefore does NOTHING on purpose; clear it by
 *   hand, having first looked at what it is holding.
 *
 * ★ THE DISJOINTNESS `withClears()` EXISTS TO ENFORCE IS THEREFORE VACUOUS HERE: with no clear list
 *   there is no key that can be set and deleted in one call, which is the failure it guards. If a
 *   later change does add one it must go through `withClears()` AND teach the client to repeat the
 *   key — half of that is a 400, and the other half is PVE's spelling sent to a PBS host.
 */
export const updateBody = (props: PruneJobProps): Record<string, string> => {
  requireKeeps(props);
  return shape(props);
};
