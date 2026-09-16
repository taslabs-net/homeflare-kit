import type { SyncJobAttributes, SyncJobProps } from './pbs-sync-job.ts';
/**
 * A sync job on the wire: how a PBS answer becomes comparable values, how a declaration becomes a
 * create or an update, and — because that question is downstream of this one — when it has changed.
 *
 * ★ SPLIT OUT OF pbs-sync-job.ts FOR THE 250-LINE CAP; the ★ SEAM there says why `matches` came
 *   with the wire instead of staying with the props. The `import type` back is a cycle on paper
 *   only — erased before anything runs, so the runtime arrow points one way, resource to wire.
 *
 * ★ IT USES THE SHARED PVE CLIENT, NOT A PBS ONE. An earlier draft of this file was written
 *   against a `./pbs-client.ts` that never existed, and spelled out what it would have to export.
 *   That module is not needed: PBS speaks the same `/api2/json` paths and the same `{"data": …}`
 *   envelope, its OpenBao mount vends the same `{token_id, secret}`, and the only difference is
 *   the authorization header — so `PveTarget` carries a `scheme` and `authorization()` spells
 *   `PBSAPIToken=<id>:<secret>` for `'pbs'`. `pveHandlers` and `pveOperations` work unchanged.
 *   The one PBS-specific thing that survived is the FORM TYPE: PBS decodes a multi-valued field
 *   from repeated keys, and `PveForm` in client.ts admits a list for exactly that reason.

 */
import { pveHandlers } from './resource.ts';
import { bool, int, text } from './values.ts';

/**
 * The marker for "PBS has no value for this number".
 *
 * ⚠️ `-1` RATHER THAN `0`, AND metric-server.ts's `UNSET = -1` IS THE PRECEDENT. `max-depth` has a
 *   legal value of 0 — sync this namespace and no child of it — which is a completely different
 *   instruction from the absent field, where PBS recurses as deep as it is allowed. Using 0 as the
 *   marker would make "no recursion" and "full recursion" the same attribute. `rate-in` and
 *   `transfer-last` take the same marker for uniformity rather than because 0 is legal for them:
 *   depending on a schema minimum I could not measure is exactly the kind of guess that becomes a
 *   forever-diff.
 */
export const UNSET = -1;

/** ⚠️ BINARY AND DECIMAL BOTH, because PBS's HumanByte can print either and parses both. */
const UNITS: Record<string, number> = {
  '': 1,
  B: 1,
  GB: 1e9,
  GiB: 1073741824,
  KB: 1e3,
  KiB: 1024,
  MB: 1e6,
  MiB: 1048576,
  TB: 1e12,
  TiB: 1099511627776,
};

/**
 * A PBS rate limit off the wire, as a plain byte count.
 *
 * ⛔ THE VALUE GOES OUT AS A NUMBER AND COMES BACK AS PROSE. PBS types `rate-in` as a `HumanByte`,
 *   which parses `10485760` on the way in and prints something like `10.00 MiB` on the way out, so
 *   the two sides of a comparison are never the same string. Flattening both to bytes is what makes
 *   the field comparable at all. REASONED from the type's parse/print asymmetry, NOT measured —
 *   there was no credential to round-trip one with.
 * ⚠️ IT ROUNDS, AND A RATE THAT DOES NOT DIVIDE EVENLY WILL NEVER SETTLE. `10.00 MiB` carries two
 *   decimals, so a declared 10485761 reads back as 10485760, `matches` reports an update, the PUT
 *   writes the same rounded value, and the next plan reports it again — forever. Declare a whole
 *   multiple of a binary unit. This is the likeliest forever-diff in the family and the first thing
 *   to check on the first plan against a live PBS.
 * ⚠️ AN UNPARSEABLE ANSWER READS AS `UNSET`, which for a DECLARED rate means "not equal" and so an
 *   update rather than a silent noop. Wrong-but-loud is the right way round here.
 */
export const bytes = (value: unknown): number => {
  if (typeof value === 'number') return value;
  const raw = text(value).trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z]*)$/.exec(raw);
  if (match === null) return UNSET;
  const unit = UNITS[match[2] ?? ''];
  return unit === undefined ? UNSET : Math.round(Number(match[1] ?? '0') * unit);
};

/**
 * The live group filters, joined for a human.
 *
 * ⚠️ DISPLAY ONLY — NEVER SENT, NEVER COMPARED. The ⛔ on the `group-filter` prop says why the field
 *   is not declarable; this exists so that a plan against an adopted job SHOWS the filters this
 *   resource is deliberately leaving alone, rather than making them invisible.
 * ⚠️ THE SEPARATOR IS ` | `, NOT A COMMA: a `regex:` filter may contain either, so no join here is
 *   unambiguous — and a comma is the one that would invite somebody to parse this back.
 */
export const filters = (value: unknown): string =>
  Array.isArray(value) ? value.map((entry: unknown) => String(entry)).join(' | ') : text(value);

/**
 * The half of a declaration that create and update both send.
 *
 * ⛔ `remove-vanished` IS ALWAYS SENT, AT ITS DEFAULT INCLUDED, and that is the one field here that
 *   breaks the "undeclared is unmanaged" rule on purpose. It is always COMPARED (see `matches`), and
 *   backup-job.ts records why the two must agree: a field compared against a default but not sent as
 *   that default is an update reported on every plan that the PUT never performs. `0` is the
 *   direction that does not delete; the prop says why that is still not a free edit.
 * ⚠️ THE TERNARY IS NOT A REFUSAL TO REUSE values.ts's `flag()`; IT IS WHAT `flag()` IS DOCUMENTED
 *   NOT TO DO. That coercion answers `undefined` for an undeclared boolean precisely so an omitted
 *   field is never sent — it is the tool for "send it only if declared", and this is the one field
 *   that must be sent ALWAYS. Calling it here types as `string | undefined` and tsc rejects the
 *   form (MEASURED: TS2322, "Type 'undefined' is not assignable to type 'string'"), which is the
 *   type system saying the same thing. replication-job-form.ts writes its always-sent `disable` the
 *   same way, for the same reason.
 * ⚠️ `1`/`0` RATHER THAN `true`/`false`: PBS's boolean schema accepts both spellings (DOCUMENTED),
 *   and one spelling shared with the PVE families is one fewer thing to keep in step.
 * ⚠️ EVERY OTHER FIELD IS SPREAD IN ONLY WHEN DECLARED. An undeclared key is not sent, so PBS leaves
 *   it exactly as it is — which is what makes adopting a hand-made job non-destructive.
 */
const shape = (props: SyncJobProps) => ({
  'remote-store': props['remote-store'],
  'remove-vanished': props['remove-vanished'] === true ? '1' : '0',
  store: props.store,
  ...(props.comment === undefined ? {} : { comment: props.comment }),
  ...(props['max-depth'] === undefined ? {} : { 'max-depth': String(props['max-depth']) }),
  ...(props.ns === undefined ? {} : { ns: props.ns }),
  ...(props.owner === undefined ? {} : { owner: props.owner }),
  ...(props['rate-in'] === undefined ? {} : { 'rate-in': String(props['rate-in']) }),
  ...(props.remote === undefined ? {} : { remote: props.remote }),
  ...(props['remote-ns'] === undefined ? {} : { 'remote-ns': props['remote-ns'] }),
  ...(props.schedule === undefined ? {} : { schedule: props.schedule }),
  ...(props['verified-only'] === undefined
    ? {}
    : { 'verified-only': props['verified-only'] ? '1' : '0' }),
  ...(props['transfer-last'] === undefined
    ? {}
    : { 'transfer-last': String(props['transfer-last']) }),
});

/**
 * ⛔ `id` IS SENT AND IS NOT OPTIONAL. PBS's create takes it rather than inventing one, so this
 *   family avoids backup-job.ts's worst failure by construction — but only while the id is here.
 *   A POST without one would be refused rather than silently duplicating the job, which is the
 *   better failure, and it is still not a reason to leave it out.
 * ⛔ `sync-direction` IS THE ONE FIELD SENT ONLY ON CREATE. It decides which side `remove-vanished`
 *   deletes from, it is not compared (see `matches`), and on a PBS old enough to have no push
 *   support it is an unknown parameter — so sending it on every update would turn every deploy
 *   against such a server into a 400 over a field nobody was changing.
 */
export const createBody = (props: SyncJobProps): Record<string, string> => ({
  ...shape(props),
  id: props.id,
  ...(props['sync-direction'] === undefined ? {} : { 'sync-direction': props['sync-direction'] }),
});

/**
 * ⚠️ THE UPDATE IS THE SHARED HALF AND NOTHING ELSE — no `id` (it is the path), no
 *   `sync-direction`, no `delete` list. The factory only PUTs when `matches` is false and the form
 *   is non-empty, and this form is never empty because `remove-vanished` and the two store names
 *   are always present. That is fine here: reconcile reaches this line only when something really
 *   does differ, and re-sending the two store names it just compared is a write of what is already
 *   there rather than a change.
 */
export const updateBody = (props: SyncJobProps): Record<string, string> => shape(props);

export const handlers = pveHandlers<SyncJobProps, SyncJobAttributes>({
  /**
   * ⛔ NO "IS IT REALLY THERE" GUARD, for backup-job.ts's reason: absence is the API declining to
   *   answer, which the factory's `read` already handles, not a key missing from an answer that did
   *   arrive. Every fallback below is PBS's documented default rather than one picked for
   *   convenience, so the answer does not depend on whether a release echoes a key it never wrote.
   * ⛔ EXCEPT `store` AND `remote-store`, WHICH FALL BACK TO `''` RATHER THAN TO THE DECLARED VALUE.
   *   They are the only required fields `matches` COMPARES, and a props-shaped fallback would make a
   *   malformed answer compare EQUAL — drift that hides itself, where `''` can only be loud. `id`
   *   keeps its props fallback: it is the path the object was read by, and is never compared.
   * ⚠️ `digest` IS DELIBERATELY NOT AN ATTRIBUTE. PBS returns one for `sync.cfg` as a FILE, so
   *   keeping it would rewrite this resource's state whenever an unrelated sync job was edited —
   *   churn that reads like drift. ha-resource.ts hit exactly that on PVE.
   * ⚠️ NEITHER IS THE RUN STATUS. `last-run-state`, `last-run-upid`, `last-run-endtime` and
   *   `next-run` come from the LIST endpoint, not from `GET /config/sync/{id}` which this reads.
   *   A plan whose output changes every time the job runs is a plan people stop reading.
   */
  attributes: (live, props) => ({
    comment: text(live['comment'], ''),
    'group-filter': filters(live['group-filter']),
    id: props.id,
    'max-depth': int(live['max-depth'], UNSET),
    ns: text(live['ns'], ''),
    owner: text(live['owner'], ''),
    'rate-in': bytes(live['rate-in']),
    remote: text(live['remote'], ''),
    'remote-ns': text(live['remote-ns'], ''),
    'remote-store': text(live['remote-store'], ''),
    // ⚠️ PBS answers with a JSON `true`/`false` where PVE answers `1`/`0`; `bool` takes both, and
    //   takes the string `'false'` correctly too if some release spells it that way.
    'remove-vanished': bool(live['remove-vanished'], false),
    schedule: text(live['schedule'], ''),
    // ⚠️ ABSENT MEANS FALSE, the PBS-side default — so an undeclared prop and a job that never had
    //   the field compare equal, and adopting one does not plan an edit.
    'verified-only': bool(live['verified-only'], false),
    store: text(live['store'], ''),
    'sync-direction': text(live['sync-direction'], 'pull'),
    'transfer-last': int(live['transfer-last'], UNSET),
  }),
  collection: () => 'config/sync',
  createForm: createBody,
  /**
   * ⛔ ONLY FIELDS A WRITE CAN ACTUALLY SET ARE COMPARED, and on PBS that list is REASONED rather
   *   than measured: the published update schema for `PUT /config/sync/{id}` takes every property
   *   of the job except its `id`. If a release turns out to refuse one of these, the comparison
   *   becomes an update the PUT cannot perform — reported on every plan, forever. That is what the
   *   first plan against a live PBS is for.
   * ⚠️ `remove-vanished` IS COMPARED UNCONDITIONALLY — undeclared means false. Every other optional
   *   field reads "not declared, or equal": undeclared is UNMANAGED, so a schedule, comment, owner,
   *   namespace or limit somebody set by hand survives adoption untouched. The destructive one does
   *   not get that courtesy, and the price is that adopting a job with it switched on is a real
   *   edit, announced only as "update" — toward not deleting, and toward a datastore that grows.
   * ⚠️ `store` AND `remote-store` ARE COMPARED UNCONDITIONALLY because PBS requires them at create,
   *   so there is no undeclared case to protect. `remote` is NOT: an absent `remote` on an existing
   *   job would otherwise plan an update clearing it, and `remote=` is not a value PBS's id schema
   *   accepts — a failing PUT on every deploy, over a field the declaration never mentioned.
   * ⚠️ `id`, `group-filter` AND `sync-direction` ARE OUT. The first is the path, a change to which
   *   is a different object; the other two are argued on their props in pbs-sync-job.ts.
   */
  matches: (attributes, props) =>
    attributes['remove-vanished'] === (props['remove-vanished'] === true) &&
    attributes.store === props.store &&
    attributes['remote-store'] === props['remote-store'] &&
    (props.remote === undefined || attributes.remote === props.remote) &&
    (props.ns === undefined || attributes.ns === props.ns) &&
    (props['remote-ns'] === undefined || attributes['remote-ns'] === props['remote-ns']) &&
    (props.schedule === undefined || attributes.schedule === props.schedule) &&
    (props.comment === undefined || attributes.comment === props.comment) &&
    (props.owner === undefined || attributes.owner === props.owner) &&
    // ⚠️ NOT COMPARED UNCONDITIONALLY, unlike `remove-vanished`. Turning `verified-only` ON is the
    //   safe direction (sync less), so undeclared stays UNMANAGED like every other optional field;
    //   `remove-vanished` gets the unconditional treatment because its unsafe direction deletes.
    (props['verified-only'] === undefined ||
      attributes['verified-only'] === props['verified-only']) &&
    (props['rate-in'] === undefined || attributes['rate-in'] === props['rate-in']) &&
    (props['max-depth'] === undefined || attributes['max-depth'] === props['max-depth']) &&
    (props['transfer-last'] === undefined ||
      attributes['transfer-last'] === props['transfer-last']),
  /** ⚠️ A Proxmox safe id has no `/` or `:` in it, so there is nothing here to encode. */
  path: (props) => `config/sync/${props.id}`,
  updateForm: updateBody,
});
