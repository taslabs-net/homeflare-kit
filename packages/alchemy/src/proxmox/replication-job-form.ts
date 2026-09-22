/**
 * A replication job's props, as the id and the forms PVE wants.
 *
 * ★ SPLIT OUT OF replication-job.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, on the same seam
 *   metric-server-form.ts uses and for the same reason: this file answers "how does a declaration
 *   become a PVE write", and replication-job.ts answers "what is a replication job and when has it
 *   changed". Nothing here reads the cluster and nothing here decides a diff.
 *
 * ⚠️ THE `import type` BACK TO replication-job.ts IS A CYCLE ON PAPER ONLY. It is type-only, so it
 *   is erased before anything runs, and `ReplicationJobProps` stays the resource's public shape in
 *   the file that declares the resource rather than being moved somewhere odd to dodge the arrow.
 */
import type { ReplicationJobProps } from './replication-job.ts';

/**
 * PVE's own documented default for `schedule`, applied on BOTH sides of the comparison.
 *
 * ⚠️ IT LIVES HERE BECAUSE BOTH HALVES NEED THE SAME STRING. `shape` sends it and `attributes`
 *   falls back to it; two copies of that literal in two files is exactly the drift that makes a
 *   plan report an update over a value nobody set.
 * ⚠️ AND IT IS NEVER SPELLED OUT IN A COMMENT, because the string PVE chose ENDS A BLOCK COMMENT:
 *   the two characters before the `15` are the comment terminator, and tsc says so loudly. It is
 *   referred to by name everywhere else in these two files for that reason, not for style.
 */
export const DEFAULT_SCHEDULE = '*/15';

/**
 * `{guest, jobnum}` -> `100-0`, the id in the only spelling PVE ever answers with.
 *
 * ⚠️ NUMBERS IN, SO CANONICAL OUT. PVE runs both halves of a job id through `int()` on parse — see
 *   the ⛔ in replication-job.ts — and a JavaScript number has no leading-zero spelling to lose.
 *   That is the whole reason this resource is keyed on two numbers instead of one string.
 */
export const jobId = (props: ReplicationJobProps) =>
  `${String(props.guest)}-${String(props.jobnum)}`;

/**
 * The mutable half, shared by create and update.
 *
 * ⚠️ `schedule`, `disable` AND `comment` ARE ALWAYS SENT, EVEN AT THEIR DEFAULTS, because they are
 *   always compared — and a field compared against a default but not SENT as that default is an
 *   update reported on every plan that the PUT never performs (backup-job.ts records the same
 *   trade). The empty string is how PVE is told to clear a comment. `rate` is the opposite case:
 *   not declared, not sent, not compared, so a rate limit set by hand survives adoption untouched.
 * ⛔ `source` IS NEVER SENT, AND SENDING IT WOULD BE WORSE THAN REDUNDANT. MEASURED in
 *   API2/ReplicationConfig.pm: create does `$param->{source} //= $guest_info->{node}` — PVE fills
 *   it from wherever the guest actually is — and DIES with "Source '<x>' does not match current
 *   node of guest" when a declaration disagrees. There is no correct value to hold here.
 */
const shape = (props: ReplicationJobProps) => ({
  comment: props.comment ?? '',
  disable: props.disable === true ? '1' : '0',
  schedule: props.schedule ?? DEFAULT_SCHEDULE,
  ...(props.rate === undefined ? {} : { rate: String(props.rate) }),
});

/**
 * ⚠️ `type` IS A CONSTANT RATHER THAN A PROP: `local` is the only section type PVE registers, and
 *   an enum of one value is a prop that can only ever be wrong. `id` and `target` are both required
 *   by the create schema and neither belongs in `shape` — `target` because PUT will not take it.
 * ⛔ THIS LINE IS THE ONLY PLACE PVE'S KEY `target` IS SPELLED, and the value beside it comes from
 *   `targetNode`. The two words are different objects — a node name here, the whole cluster in
 *   `WithTarget.target` — and the ⛔ in replication-job.ts explains why the rename was forced.
 */
export const createBody = (props: ReplicationJobProps) => ({
  ...shape(props),
  id: jobId(props),
  target: props.targetNode,
  type: 'local',
});

/**
 * ⛔ `delete=remove_job` ON EVERY UPDATE IS THE DELIBERATE PART. PVE's PUT merges the form into the
 *   section and cannot unset anything, so without this the removal marker a DELETE wrote would
 *   survive every reconcile and `matches` would report an update that never lands. MEASURED as
 *   legal: the update handler refuses `delete` only for required or `fixed` options, and
 *   `remove_job => { optional => 1 }` is neither; deleting a key that is not set is a no-op, so
 *   this is safe to send unconditionally.
 * ⛔ AND THE DELETE LIST IS THIS ONE CONSTANT KEY, NEVER A COMPUTED "everything you did not
 *   declare". backup-job.ts spells out why the computed form is dangerous — it strips settings the
 *   resource does not even model off a job adopted from the UI. `remove_job` cannot be declared
 *   here at all, so clearing it can only ever undo a removal this stack did not ask for.
 *   ⚠️ IT CANCELS A REMOVAL SOMEBODY STARTED, WHICH IS THE POINT AND IS STILL WORTH KNOWING. If the
 *     removal pass already ran its local-snapshot half, the revived job re-sends in full.
 */
export const updateBody = (props: ReplicationJobProps) => ({
  ...shape(props),
  delete: 'remove_job',
});
