/** PBS 4.2.6-1 values and vendor form guards; SDK transport is in pbs-verify-job-wire.ts. */
import type { PbsVerifyJobAttributes, PbsVerifyJobProps } from './pbs-verify-job.ts';
import type { PveSpec } from './resource-spec.ts';
import { rechecks, shape } from './pbs-verify-job-form.ts';
import { bool, int, text } from './values.ts';

/**
 * ⚠️ EVERY FIELD IS READ THROUGH `values.ts` THOUGH PBS RETURNS REAL JSON TYPES. Unlike PVE's
 *   SectionConfig round-trip, `GET /config/verify/{id}` serialises a Rust struct, so
 *   `ignore-verified` arrives as a JSON boolean and `max-depth` as a JSON number. `bool` and `int`
 *   accept both spellings, and using them costs nothing while covering the version that does not.
 * ⚠️ `digest` IS NOT AN ATTRIBUTE AND CANNOT BECOME ONE BY ACCIDENT. PBS puts it on the rpcenv, and
 *   the JSON formatter adds rpcenv attributes as SIBLINGS of `data` — `{"data":{…},"digest":"…"}` —
 *   so both the old client and the SDK expose only the resource data. Attributes deliberately
 *   exclude it: the digest covers verification.cfg as a FILE, so keeping it would churn state
 *   whenever an unrelated verify job was edited.
 */
export const spec: PveSpec<PbsVerifyJobProps, PbsVerifyJobAttributes> = {
  attributes: (live, props) => {
    const ignoreVerified = bool(live['ignore-verified'], true);
    const outdatedAfter = int(live['outdated-after'], -1);
    return {
      comment: text(live['comment'], ''),
      id: props.id,
      'ignore-verified': ignoreVerified,
      'max-depth': int(live['max-depth'], -1),
      ns: text(live['ns'], ''),
      'outdated-after': outdatedAfter,
      rechecks: rechecks(ignoreVerified, outdatedAfter),
      schedule: text(live['schedule'], ''),
      store: text(live['store'], props.store),
    };
  },
  /**
   * 🔴 THIS WAS `config/verification` AND PBS ANSWERS 404 FOR IT. MEASURED on the live 4.2 server:
   *   `GET /api2/json/config/verification` -> 404 "Path not found"; `GET /api2/json/config/verify`
   *   -> 200 with both jobs. The struct is `VerificationJobConfig` and the CLI subcommand is
   *   `verify-job`, so the long spelling reads right and is simply not the route.
   *   ⛔ THE OLD FAILURE MODE: `read` folded every failure into `undefined`, so a 404 from a
   *   WRONG PATH was indistinguishable from an object that was not
   *   there. The first plan against the live estate said `create` for two verification jobs that
   *   have existed for weeks — and a create would then have POSTed to a 404 as well, so it fails
   *   loudly rather than duplicating anything. Nothing caught it earlier because no verification
   *   job had ever been declared; registering the provider exercises no path at all.
   */
  collection: () => 'config/verify',
  /** ⛔ `id` IS SENT. PBS refuses a duplicate id, and that refusal is this family's safety net. */
  createForm: (props) => ({ ...shape(props), id: props.id }),
  /**
   * ⚠️ AN UNDECLARED FIELD IS NEITHER SENT NOR COMPARED — the `Proxmox.BackupJob` trade, for the
   *   same reason and with one extra: this form carries NO `delete` list, so there is nothing it
   *   could clear even if it wanted to. See the ⛔ on `withClears` in pbs-verify-job-form.ts.
   * ⚠️ `store` IS COMPARED AND IS MUTABLE, which is unusual and worth reading twice. PBS's update
   *   handler assigns it and re-checks privileges on both the old and the new path, so changing
   *   `store` MOVES the job — and the datastore it left is then verified by nothing. That is a
   *   one-word edit with the same effect as deleting the job, and it plans as a quiet `update`.
   * ⚠️ `rechecks` IS ABSENT HERE ON PURPOSE. It is a rendering of the two fields on the lines
   *   above; comparing it too would report the same drift twice.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pbs:POST /config/verify', update: 'pbs:PUT /config/verify/{id}' },
  matches: (attributes, props) =>
    attributes.store === props.store &&
    // ⚠️ `null` IS COMPARED AGAINST `''`, NOT SKIPPED. A parked job is a declaration like any
    //   other, so declaring `null` against a job that HAS a schedule must plan an update — the
    //   form then omits `schedule`, which is a set-only form, so see the ⛔ on clearing below.
    attributes.schedule === (props.schedule ?? '') &&
    attributes['ignore-verified'] === (props['ignore-verified'] !== false) &&
    (props['outdated-after'] === undefined ||
      attributes['outdated-after'] === props['outdated-after']) &&
    (props['max-depth'] === undefined || attributes['max-depth'] === props['max-depth']) &&
    (props.ns === undefined || attributes.ns === props.ns) &&
    (props.comment === undefined || attributes.comment === props.comment),
  path: (props) => `config/verify/${props.id}`,
  updateForm: shape,
};
