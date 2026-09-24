/** PBS 4.2.6-1 operations through @distilled.cloud/proxmox-backup. */
import * as config from '@distilled.cloud/proxmox-backup/config';
import * as Effect from 'effect/Effect';
import { runPbs } from './distilled-pbs.ts';
import type { PbsVerifyJobProps } from './pbs-verify-job.ts';
import { shape } from './pbs-verify-job-form.ts';
import { spec } from './pbs-verify-job-spec.ts';

/** SDK member names differ from the vendor form names; omission stays unmanaged. */
const members = (form: Record<string, string>) => ({
  ...(form['ignore-verified'] === undefined ? {} : { ignore_verified: form['ignore-verified'] }),
  ...(form['store'] === undefined ? {} : { store: form['store'] }),
  ...(form['schedule'] === undefined ? {} : { schedule: form['schedule'] }),
  ...(form['comment'] === undefined ? {} : { comment: form['comment'] }),
  ...(form['max-depth'] === undefined ? {} : { max_depth: form['max-depth'] }),
  ...(form['ns'] === undefined ? {} : { ns: form['ns'] }),
  ...(form['outdated-after'] === undefined ? {} : { outdated_after: form['outdated-after'] }),
});

const createRequest = (props: PbsVerifyJobProps): config.VerifyConfigRequest => ({
  ...members({ ...shape(props), id: props.id }),
  id: props.id,
  store: props.store,
});

const updateRequest = (props: PbsVerifyJobProps): config.PutConfigVerifyRequest => ({
  ...members(shape(props)),
  id: props.id,
});

/** Preserve the state attribute shape while the SDK decodes its typed field names. */
const wire = (row: config.GetConfigVerifyResponse): Record<string, unknown> => ({
  ...row,
  'ignore-verified': row.ignore_verified,
  'max-depth': row.max_depth,
  'outdated-after': row.outdated_after,
});

/** ⛔ Only the SDK VerifyJobNotFound is absence; permission, transport and malformed replies propagate. */
export const readOne = (props: PbsVerifyJobProps) =>
  runPbs(props.target, 'read', config.getConfigVerify({ id: props.id })).pipe(
    Effect.map((row) => spec.attributes(wire(row), props)),
    Effect.catchTag('VerifyJobNotFound', () => Effect.succeed(undefined)),
  );

export const createOne = (props: PbsVerifyJobProps) =>
  runPbs(props.target, 'provision', config.verifyConfig(createRequest(props)));

export const updateOne = (props: PbsVerifyJobProps) =>
  runPbs(props.target, 'provision', config.putConfigVerify(updateRequest(props)));

/** Deleting the schedule never deletes backups; already missing is a successful deletion. */
export const deleteOne = (props: PbsVerifyJobProps) =>
  Effect.gen(function* () {
    // ⛔ Missing-item tags are measured for GET only. Do not guess the DELETE error shape.
    if ((yield* readOne(props)) === undefined) return;
    return yield* runPbs(props.target, 'provision', config.deleteConfigVerify({ id: props.id }));
  });
