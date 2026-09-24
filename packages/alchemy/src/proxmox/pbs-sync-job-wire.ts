/** PBS 4.2.6-1 operations through @distilled.cloud/proxmox-backup. */
import * as config from '@distilled.cloud/proxmox-backup/config';
import * as Effect from 'effect/Effect';
import { runPbs } from './distilled-pbs.ts';
import type { SyncJobProps } from './pbs-sync-job.ts';
import { createBody, updateBody } from './pbs-sync-job-form.ts';
import { spec } from './pbs-sync-job-form.ts';

/** SDK member names differ from the vendor form names; omission stays unmanaged. */
const members = (form: Record<string, string>) => ({
  ...(form['remote-store'] === undefined ? {} : { remote_store: form['remote-store'] }),
  ...(form['remove-vanished'] === undefined ? {} : { remove_vanished: form['remove-vanished'] }),
  ...(form['store'] === undefined ? {} : { store: form['store'] }),
  ...(form['comment'] === undefined ? {} : { comment: form['comment'] }),
  ...(form['max-depth'] === undefined ? {} : { max_depth: form['max-depth'] }),
  ...(form['ns'] === undefined ? {} : { ns: form['ns'] }),
  ...(form['owner'] === undefined ? {} : { owner: form['owner'] }),
  ...(form['rate-in'] === undefined ? {} : { rate_in: form['rate-in'] }),
  ...(form['remote'] === undefined ? {} : { remote: form['remote'] }),
  ...(form['remote-ns'] === undefined ? {} : { remote_ns: form['remote-ns'] }),
  ...(form['schedule'] === undefined ? {} : { schedule: form['schedule'] }),
  ...(form['verified-only'] === undefined ? {} : { verified_only: form['verified-only'] }),
  ...(form['transfer-last'] === undefined ? {} : { transfer_last: form['transfer-last'] }),
  ...(form['sync-direction'] === undefined ? {} : { sync_direction: form['sync-direction'] }),
});

const createRequest = (props: SyncJobProps): config.SyncConfigRequest => ({
  ...members(createBody(props)),
  id: props.id,
  store: props.store,
  remote_store: props['remote-store'],
});

const updateRequest = (props: SyncJobProps): config.PutConfigSyncRequest => ({
  ...members(updateBody(props)),
  id: props.id,
});

/** Preserve the state attribute shape while the SDK decodes its typed field names. */
const wire = (row: config.GetConfigSyncResponse): Record<string, unknown> => ({
  ...row,
  'remote-store': row.remote_store,
  'remove-vanished': row.remove_vanished,
  'max-depth': row.max_depth,
  'rate-in': row.rate_in,
  'remote-ns': row.remote_ns,
  'verified-only': row.verified_only,
  'transfer-last': row.transfer_last,
  'sync-direction': row.sync_direction,
  'group-filter': row.group_filter,
});

/** ⛔ Only the SDK SyncJobNotFound is absence; permission, transport and malformed replies propagate. */
export const readOne = (props: SyncJobProps) =>
  runPbs(props.target, 'read', config.getConfigSync({ id: props.id })).pipe(
    Effect.map((row) => spec.attributes(wire(row), props)),
    Effect.catchTag('SyncJobNotFound', () => Effect.succeed(undefined)),
  );

export const createOne = (props: SyncJobProps) =>
  runPbs(props.target, 'provision', config.syncConfig(createRequest(props)));

export const updateOne = (props: SyncJobProps) =>
  runPbs(props.target, 'provision', config.putConfigSync(updateRequest(props)));

/** Deleting the schedule never deletes backups; already missing is a successful deletion. */
export const deleteOne = (props: SyncJobProps) =>
  Effect.gen(function* () {
    // ⛔ Missing-item tags are measured for GET only. Do not guess the DELETE error shape.
    if ((yield* readOne(props)) === undefined) return;
    return yield* runPbs(props.target, 'provision', config.deleteConfigSync({ id: props.id }));
  });
