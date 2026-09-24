/** Pure existing forms, normalization and equality, shared by plan and SDK lifecycle. */
import type { BackupJobAttributes, BackupJobProps } from './backup-job.ts';
import type { PveSpec } from './resource-spec.ts';
import { bool, guestList, propertyString, text } from './values.ts';

/**
 * The form for both create and update.
 *
 * ⛔ A FIELD THE DECLARATION LEAVES OUT IS NOT SENT, AND THAT IS LOAD BEARING. PVE's PUT can only
 *   SET a key; clearing one needs `delete=<key>`, which this resource deliberately never sends.
 *   `updateForm` is handed the props and nothing else, so a `delete` list could only be "every
 *   field you did not declare" — and on a job adopted out of the UI that would silently strip
 *   settings this resource does not even model, `compress`, `mailto` and `bwlimit` among them, on
 *   the first deploy. Leaving undeclared fields alone is the smaller lie, and `matches` tells the
 *   same lie consistently: it does not compare what it cannot change.
 *
 * ⚠️ THE FIVE FIELDS PVE DOCUMENTS A DEFAULT FOR ARE ALWAYS SENT AND ALWAYS COMPARED — `enabled`
 *   (1), `all` (0), `mode` (snapshot), `notification-mode` (auto), `repeat-missed` (0). That is
 *   what makes a hand-flipped `enabled 0` show up as drift rather than as silence, and it is also
 *   what stops those five looping: a field compared against a default must be sent as that
 *   default, or every plan reports an update the PUT never performs. The cost is worth reading
 *   before the first deploy against an adopted job — an omitted `all` is a declaration that this
 *   job backs up NOTHING, and PVE accepts a job that selects nothing without a word. Read that
 *   first plan; do not deploy it unseen.
 */
const shape = (props: BackupJobProps) => ({
  all: props.all === true ? '1' : '0',
  enabled: props.enabled === false ? '0' : '1',
  mode: props.mode ?? 'snapshot',
  'notification-mode': props['notification-mode'] ?? 'auto',
  'repeat-missed': props['repeat-missed'] === true ? '1' : '0',
  schedule: props.schedule,
  ...(props.comment === undefined ? {} : { comment: props.comment }),
  ...(props.exclude === undefined ? {} : { exclude: guestList(props.exclude) }),
  ...(props.fleecing === undefined ? {} : { fleecing: props.fleecing }),
  ...(props['notes-template'] === undefined ? {} : { 'notes-template': props['notes-template'] }),
  ...(props.pool === undefined ? {} : { pool: props.pool }),
  ...(props['prune-backups'] === undefined ? {} : { 'prune-backups': props['prune-backups'] }),
  ...(props.storage === undefined ? {} : { storage: props.storage }),
  ...(props.vmid === undefined ? {} : { vmid: guestList(props.vmid) }),
});

export const backupJobSpec = {
  /**
   * ⛔ NO "IS IT REALLY THERE" GUARD, ON PURPOSE. Returning undefined for a job whose JSON is
   *   missing some key would be a guess about which keys PVE echoes back, and a wrong guess here
   *   does not read as absent-and-harmless: `reconcile` would POST, and POST creates ANOTHER job.
   *   Absence is decided by the API declining to answer, which `pveOperations.read` already
   *   handles — not by a key being missing from an answer that did arrive.
   */
  attributes: (live, props) => ({
    all: bool(live['all'], false),
    comment: text(live['comment'], ''),
    enabled: bool(live['enabled'], true),
    exclude: guestList(live['exclude']),
    fleecing: propertyString(live['fleecing'], 'enabled'),
    id: props.id,
    mode: text(live['mode'], 'snapshot'),
    'next-run': typeof live['next-run'] === 'number' ? live['next-run'] : 0,
    'notes-template': text(live['notes-template'], ''),
    'notification-mode': text(live['notification-mode'], 'auto'),
    pool: text(live['pool'], ''),
    'prune-backups': propertyString(live['prune-backups']),
    'repeat-missed': bool(live['repeat-missed'], false),
    schedule: text(live['schedule'], ''),
    storage: text(live['storage'], ''),
    vmid: guestList(live['vmid']),
  }),
  collection: () => 'cluster/backup',
  /** ⛔ `id` IS SENT AND IS NOT OPTIONAL. Everything above depends on PVE not inventing one. */
  createForm: (props) => ({ ...shape(props), id: props.id }),
  /** Each line reads "not declared, or equal"; the five defaulted fields have no undeclared case. */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pve:POST /cluster/backup', update: 'pve:PUT /cluster/backup/{id}' },
  matches: (attributes, props) =>
    attributes.schedule === props.schedule &&
    attributes.enabled === (props.enabled !== false) &&
    attributes.all === (props.all === true) &&
    attributes.mode === (props.mode ?? 'snapshot') &&
    attributes['notification-mode'] === (props['notification-mode'] ?? 'auto') &&
    attributes['repeat-missed'] === (props['repeat-missed'] === true) &&
    (props.storage === undefined || attributes.storage === props.storage) &&
    (props.pool === undefined || attributes.pool === props.pool) &&
    (props.comment === undefined || attributes.comment === props.comment) &&
    (props.vmid === undefined || attributes.vmid === guestList(props.vmid)) &&
    (props.exclude === undefined || attributes.exclude === guestList(props.exclude)) &&
    (props['notes-template'] === undefined ||
      attributes['notes-template'] === props['notes-template']) &&
    (props['prune-backups'] === undefined ||
      attributes['prune-backups'] === propertyString(props['prune-backups'])) &&
    (props.fleecing === undefined ||
      attributes.fleecing === propertyString(props.fleecing, 'enabled')),
  path: (props) => `cluster/backup/${props.id}`,
  updateForm: shape,
} satisfies PveSpec<BackupJobProps, BackupJobAttributes>;
