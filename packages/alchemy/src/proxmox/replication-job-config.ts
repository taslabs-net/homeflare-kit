/** Existing comparison and form semantics, separated from the named SDK transport. */
import type { ReplicationJobAttributes, ReplicationJobProps } from './replication-job.ts';
import type { PveSpec } from './resource-spec.ts';
import { DEFAULT_SCHEDULE, createBody, jobId, updateBody } from './replication-job-form.ts';
import { bool, int, text } from './values.ts';

/**
 * ⚠️ `rate` IS THE ONLY FLOAT IN THIS PACKAGE, so it gets a coercion of its own rather than a sixth
 *   entry in `values.ts` — the rule that module states for itself: a coercion only one PVE object
 *   needs belongs in that object's file, next to the field it serves. `int` cannot serve it, since
 *   `Number.parseInt('10.5')` is 10 and a rate silently rounded down is both a limit nobody chose
 *   and a comparison that never settles. It accepts a string for the reason `int` does: these are
 *   SectionConfig sections, and whether `10` arrives as a number is a property of the release.
 * ⚠️ 0 MEANS UNSET, and is safe as the marker because PVE's schema gives `rate` a minimum of 1 —
 *   the same trick as `metric-server.ts`'s `UNSET = -1`, for the same reason.
 */
const rateOf = (value: unknown): number => {
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const replicationJobSpec = {
  /**
   * ⚠️ EVERY FALLBACK IS PVE'S DOCUMENTED DEFAULT, NOT `false`/`''` PICKED FOR CONVENIENCE, so the
   *   answer does not depend on whether a given release echoes back a key it never wrote.
   *   SectionConfig stores what it was handed; a job created in the UI without a schedule has no
   *   schedule line, and reading that absence as anything but `DEFAULT_SCHEDULE` would report
   *   drift on a job nobody touched and then WRITE the reading back.
   * ⛔ The distilled read validates the response and requested identity before applying defaults.
   *   Only the precise typed vendor exception means absence. `digest` is deliberately absent
   *   here — it changes when ANY job changes, including one somebody else declared.
   */
  attributes: (live, props) => ({
    comment: text(live['comment'], ''),
    disable: bool(live['disable'], false),
    guest: int(live['guest'], props.guest),
    id: text(live['id'], jobId(props)),
    jobnum: int(live['jobnum'], props.jobnum),
    rate: rateOf(live['rate']),
    remove_job: text(live['remove_job'], ''),
    schedule: text(live['schedule'], DEFAULT_SCHEDULE),
    source: text(live['source'], ''),
    targetNode: text(live['target'], props.targetNode),
    type: text(live['type'], 'local'),
  }),
  collection: () => 'cluster/replication',
  createForm: createBody,
  /**
   * ⚠️ `targetNode` AND `source` ARE OUT OF THIS COMPARISON FOR TWO REASONS EACH, AND EITHER ALONE
   *   WOULD BE ENOUGH. They are create-only — `target` is a `fixed` option, `source` has no honest
   *   declared value — AND PVE REWRITES BOTH BEHIND YOUR BACK. MEASURED in
   *   `switch_replication_job_target_nolock`: when a guest migrates, PVE sets
   *   `$jobcfg->{target} = $new_target` and `$jobcfg->{source} = $old_target`, so the job follows
   *   the guest. Compared, a single migration would make every later plan report an update that the
   *   PUT cannot perform, forever. The cost of leaving them out is stated on the `targetNode` prop:
   *   a changed target plans as noop, and a migrated job is not dragged back.
   * ⚠️ `guest`, `jobnum`, `type` AND `id` ARE NOT COMPARED EITHER: the first two are the id in
   *   integer form, `type` has one legal value, and `id` is the path — a change there is a
   *   different object, which reads as absent and is created.
   * ⛔ `remove_job` IS COMPARED, AND IT IS THE ONE FIELD HERE THAT LOOKS LIKE A FOREVER-UPDATE AND
   *   IS NOT. A DELETE marks the job rather than removing it, so a re-declared id can name a job
   *   that is busy deleting itself, and matching that would be a noop over a vanishing object. It
   *   settles because `updateBody` actually clears the marker — see there.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: {
    create: 'pve:POST /cluster/replication',
    update: 'pve:PUT /cluster/replication/{id}',
  },
  matches: (attributes, props) =>
    attributes.remove_job === '' &&
    attributes.schedule === (props.schedule ?? DEFAULT_SCHEDULE) &&
    attributes.disable === (props.disable === true) &&
    attributes.comment === (props.comment ?? '') &&
    (props.rate === undefined || attributes.rate === props.rate),
  path: (props) => `cluster/replication/${jobId(props)}`,
  updateForm: updateBody,
} satisfies PveSpec<ReplicationJobProps, ReplicationJobAttributes>;
