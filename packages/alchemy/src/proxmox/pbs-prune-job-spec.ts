/** PBS 4.2.6-1 values and vendor form guards; SDK transport is in pbs-prune-job-wire.ts. */
import type { PruneJobAttributes, PruneJobProps } from './pbs-prune-job.ts';
import type { PveSpec } from './resource-spec.ts';
import { createBody, keepAttributes, keepsMatch, updateBody } from './pbs-prune-job-form.ts';
import { bool, int, text } from './values.ts';

/** "Not declared, or equal" — the single shape every unmanaged field is compared with. */
const same = <T>(declared: T | undefined, live: T) => declared === undefined || declared === live;

export const spec: PveSpec<PruneJobProps, PruneJobAttributes> = {
  /**
   * ⚠️ EVERY OPTIONAL FIELD FALLS BACK TO ITS ABSENT SENTINEL RATHER THAN TO PBS'S DEFAULT, because
   *   for this family the two are different questions. `keep-daily` absent does not mean "keep zero
   *   dailies", it means "this window is not part of the policy", and `matches` must not compare a
   *   window the declaration never mentioned against an invented value.
   * ⛔ NO "IS IT REALLY THERE" GUARD, for backup-job.ts's reason: returning undefined for a job
   *   whose JSON is missing a key would be a guess about which keys PBS echoes, and a wrong guess
   *   sends reconcile down the POST branch — which creates ANOTHER prune job rather than failing.
   */
  attributes: (live, props) => ({
    comment: text(live['comment'], ''),
    disable: bool(live['disable'], false),
    id: props.id,
    ...keepAttributes(live),
    'max-depth': int(live['max-depth'], -1),
    ns: text(live['ns'], ''),
    schedule: text(live['schedule'], ''),
    store: text(live['store'], props.store),
  }),
  collection: () => 'config/prune',
  createForm: createBody,
  /**
   * ⚠️ THE UNDECLARED HALF IS NOT COMPARED, AND THAT IS THE WHOLE SAFETY MODEL. `same` reads "not
   *   declared, or equal", so a field set by hand on an adopted job survives adoption untouched and
   *   never appears as drift. `keepsMatch` applies the identical rule to the six windows, from the
   *   file that also writes and reads them — see the ★ at the top of pbs-prune-job-form.ts.
   * ⚠️ `store` AND `schedule` HAVE NO UNDECLARED CASE because both are required props, so both are
   *   compared unconditionally. A changed `store` is an update, not a replace: PBS accepts `store`
   *   on PUT, so the job is re-pointed in place.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pbs:POST /config/prune', update: 'pbs:PUT /config/prune/{id}' },
  matches: (attributes, props) =>
    attributes.schedule === props.schedule &&
    attributes.store === props.store &&
    same(props.ns, attributes.ns) &&
    same(props['max-depth'], attributes['max-depth']) &&
    same(props.disable, attributes.disable) &&
    same(props.comment, attributes.comment) &&
    keepsMatch(attributes, props),
  path: (props) => `config/prune/${props.id}`,
  updateForm: updateBody,
};
