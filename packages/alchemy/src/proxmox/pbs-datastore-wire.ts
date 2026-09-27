/** PBS 4.2.6-1 datastore SDK operations; no raw route-string transport. */
import * as config from '@distilled.cloud/proxmox-backup/config';
import * as Effect from 'effect/Effect';
import { runPbs } from './distilled-pbs.ts';
import { attributes, createForm, updateForm } from './pbs-datastore-form.ts';
import type { PbsDatastoreProps } from './pbs-datastore.ts';

/** Keep the existing form's unmanaged-field decisions while using typed SDK member names. */
const members = (form: Record<string, string>) => ({
  ...(form['comment'] === undefined ? {} : { comment: form['comment'] }),
  ...(form['counter-reset-schedule'] === undefined
    ? {}
    : { counter_reset_schedule: form['counter-reset-schedule'] }),
  ...(form['gc-schedule'] === undefined ? {} : { gc_schedule: form['gc-schedule'] }),
  ...(form['keep-daily'] === undefined ? {} : { keep_daily: form['keep-daily'] }),
  ...(form['keep-hourly'] === undefined ? {} : { keep_hourly: form['keep-hourly'] }),
  ...(form['keep-last'] === undefined ? {} : { keep_last: form['keep-last'] }),
  ...(form['keep-monthly'] === undefined ? {} : { keep_monthly: form['keep-monthly'] }),
  ...(form['keep-weekly'] === undefined ? {} : { keep_weekly: form['keep-weekly'] }),
  ...(form['keep-yearly'] === undefined ? {} : { keep_yearly: form['keep-yearly'] }),
  ...(form['maintenance-mode'] === undefined ? {} : { maintenance_mode: form['maintenance-mode'] }),
  ...(form['notification-thresholds'] === undefined
    ? {}
    : { notification_thresholds: form['notification-thresholds'] }),
  ...(form['notify'] === undefined ? {} : { notify: form['notify'] }),
  ...(form['notify-user'] === undefined ? {} : { notify_user: form['notify-user'] }),
  ...(form['prune-schedule'] === undefined ? {} : { prune_schedule: form['prune-schedule'] }),
  ...(form['tuning'] === undefined ? {} : { tuning: form['tuning'] }),
  ...(form['verify-new'] === undefined ? {} : { verify_new: form['verify-new'] }),
});

const createRequest = (props: PbsDatastoreProps): config.CreateConfigDatastoreRequest => ({
  ...members(createForm(props)),
  name: props.name,
  path: props.path,
  ...(props.backend === undefined ? {} : { backend: props.backend }),
});

const updateRequest = (props: PbsDatastoreProps): config.PutConfigDatastoreRequest => ({
  ...members(updateForm(props)),
  name: props.name,
});

const wire = (row: config.GetConfigDatastoreResponse): Record<string, unknown> => ({
  ...row,
  'counter-reset-schedule': row.counter_reset_schedule,
  'gc-schedule': row.gc_schedule,
  'keep-daily': row.keep_daily,
  'keep-hourly': row.keep_hourly,
  'keep-last': row.keep_last,
  'keep-monthly': row.keep_monthly,
  'keep-weekly': row.keep_weekly,
  'keep-yearly': row.keep_yearly,
  'maintenance-mode': row.maintenance_mode,
  'notification-thresholds': row.notification_thresholds,
  'notify-user': row.notify_user,
  'prune-schedule': row.prune_schedule,
  'verify-new': row.verify_new,
});

/**
 * ⛔ THE RAW READ FOLDED EVERY ERROR TO ABSENCE. Its `name` presence check could not distinguish
 *   a missing section from a denied read: both suggested CREATE for a datastore holding backups.
 *   The resulting "already exists" failure was loud, but the same fold on DELETE was worse:
 *   the first denied read confirmed removal while the datastore still stood.
 * ★ MEASURED 2026-09-24 against PBS 4.2.6-1: a missing section is plain-text HTTP400,
 *   `no such datastore '<name>'`. The distilled patch types that GET response as
 *   DatastoreNotFound. Only that tag means absent; no permission, transport or malformed-response
 *   error can settle deletion. This replaces the old recommendation to disambiguate by listing.
 * ⚠️ The read role still requires Datastore.Audit, and a missing grant now fails visibly.
 */
export const readOne = (props: PbsDatastoreProps) =>
  runPbs(props.target, 'read', config.getConfigDatastore({ name: props.name })).pipe(
    Effect.map((live) => attributes(wire(live), props)),
    Effect.catchTag('DatastoreNotFound', () => Effect.succeed(undefined)),
  );

export const createOne = (props: PbsDatastoreProps) =>
  runPbs(props.target, 'provision', config.createConfigDatastore(createRequest(props)));

export const updateOne = (props: PbsDatastoreProps) =>
  runPbs(props.target, 'provision', config.putConfigDatastore(updateRequest(props)));

/** ⛔ No destroy-data or keep-job-configs flag: retain the original removal contract. */
export const deleteOne = (props: PbsDatastoreProps) =>
  Effect.gen(function* () {
    // ⛔ Missing-item tags are measured for GET only. Do not guess the DELETE error shape.
    if ((yield* readOne(props)) === undefined) return;
    return yield* runPbs(
      props.target,
      'provision',
      config.deleteConfigDatastore({ name: props.name }),
    );
  });
