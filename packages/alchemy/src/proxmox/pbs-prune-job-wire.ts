/** PBS 4.2.6-1 operations through @distilled.cloud/proxmox-backup. */
import * as config from '@distilled.cloud/proxmox-backup/config';
import * as Effect from 'effect/Effect';
import { runPbs } from './distilled-pbs.ts';
import type { PruneJobProps } from './pbs-prune-job.ts';
import { createBody, updateBody } from './pbs-prune-job-form.ts';
import { spec } from './pbs-prune-job-spec.ts';

/** SDK member names differ from the vendor form names; omission stays unmanaged. */
const members = (form: Record<string, string>) => ({
  ...(form['comment'] === undefined ? {} : { comment: form['comment'] }),
  ...(form['disable'] === undefined ? {} : { disable: form['disable'] }),
  ...(form['keep-daily'] === undefined ? {} : { keep_daily: form['keep-daily'] }),
  ...(form['keep-hourly'] === undefined ? {} : { keep_hourly: form['keep-hourly'] }),
  ...(form['keep-last'] === undefined ? {} : { keep_last: form['keep-last'] }),
  ...(form['keep-monthly'] === undefined ? {} : { keep_monthly: form['keep-monthly'] }),
  ...(form['keep-weekly'] === undefined ? {} : { keep_weekly: form['keep-weekly'] }),
  ...(form['keep-yearly'] === undefined ? {} : { keep_yearly: form['keep-yearly'] }),
  ...(form['max-depth'] === undefined ? {} : { max_depth: form['max-depth'] }),
  ...(form['ns'] === undefined ? {} : { ns: form['ns'] }),
  ...(form['schedule'] === undefined ? {} : { schedule: form['schedule'] }),
  ...(form['store'] === undefined ? {} : { store: form['store'] }),
});

const createRequest = (props: PruneJobProps): config.CreateConfigPruneRequest => ({
  ...members(createBody(props)),
  id: props.id,
  store: props.store,
  schedule: props.schedule,
});

const updateRequest = (props: PruneJobProps): config.PutConfigPruneRequest => ({
  ...members(updateBody(props)),
  id: props.id,
});

/** Preserve the state attribute shape while the SDK decodes its typed field names. */
const wire = (row: config.GetConfigPruneResponse): Record<string, unknown> => ({
  ...row,
  'keep-daily': row.keep_daily,
  'keep-hourly': row.keep_hourly,
  'keep-last': row.keep_last,
  'keep-monthly': row.keep_monthly,
  'keep-weekly': row.keep_weekly,
  'keep-yearly': row.keep_yearly,
  'max-depth': row.max_depth,
});

/** ⛔ Only the SDK PruneJobNotFound is absence; permission, transport and malformed replies propagate. */
export const readOne = (props: PruneJobProps) =>
  runPbs(props.target, 'read', config.getConfigPrune({ id: props.id })).pipe(
    Effect.map((row) => spec.attributes(wire(row), props)),
    Effect.catchTag('PruneJobNotFound', () => Effect.succeed(undefined)),
  );

export const createOne = (props: PruneJobProps) =>
  runPbs(props.target, 'provision', config.createConfigPrune(createRequest(props)));

export const updateOne = (props: PruneJobProps) =>
  runPbs(props.target, 'provision', config.putConfigPrune(updateRequest(props)));

/** Deleting the schedule never deletes backups; already missing is a successful deletion. */
export const deleteOne = (props: PruneJobProps) =>
  Effect.gen(function* () {
    // ⛔ Missing-item tags are measured for GET only. Do not guess the DELETE error shape.
    if ((yield* readOne(props)) === undefined) return;
    return yield* runPbs(props.target, 'provision', config.deleteConfigPrune({ id: props.id }));
  });
