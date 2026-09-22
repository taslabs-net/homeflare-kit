/**
 * Creating a container: what an API token may create, and the body it POSTs.
 *
 * ★ SPLIT FROM lxc-judge.ts AT A REAL SEAM: the judge compares a declaration with a guest that
 *   exists; this file answers for a guest that does not, where there is nothing to compare with
 *   and the only safe answer to a doubtful key is to refuse it before the POST.
 * ⛔ THE ROOT@PAM RULES ARE THE JUDGE'S OWN (`rootOnly`, `featuresNeedRoot`), imported rather than
 *   restated, so the create and the update cannot disagree about what a token may write.
 */
import { featureWhy, featuresNeedRoot, rootOnly } from './lxc-judge.ts';
import {
  type LxcProps,
  declaredKeys,
  declaredValue,
  indexedKey,
  isManagedKey,
  wireValue,
} from './lxc-props.ts';
import { isHostPath, parseVolume } from './lxc-volume.ts';
import { scalarForm } from './lxc-wire.ts';
import { bool } from './values.ts';

/**
 * ⛔ A CREATE ALLOCATES NEW VOLUMES ONLY. pve-container's `create_disks` allocates `storage:GiB`
 *   and takes anything else as "use specified/existing volid", then `restore_archive` unpacks the
 *   template into the mounted rootfs. So a create naming `local-zfs:subvol-900-disk-0` — a pasted
 *   adoption, re-created after its config vanished while the volume survived (a `pct destroy`
 *   only WARNS when a volume will not delete) — unpacks a template over the data on it.
 */
const existingVolume = (key: string, value: string) =>
  `${key}: ${value} names an existing volume, and PVE would unpack the template onto it. A ` +
  'create allocates new volumes only: declare `storage:GiB`, and attach an existing volume by ' +
  'hand after the create.';

/** Why this declaration cannot be CREATED by an API token, if it cannot. */
export const createRefusals = (props: LxcProps): string[] => {
  const refuse: string[] = [];
  if (props.ostemplate === undefined || props.ostemplate === '') {
    refuse.push(
      `CT ${String(props.vmid)} does not exist on ${props.node}, and without \`ostemplate\` ` +
        'there is nothing to create it from. To adopt a guest, declare the node it is on.',
    );
  }
  const unprivileged = props.unprivileged === undefined ? true : bool(props.unprivileged);
  for (const key of declaredKeys(props)) {
    const value = wireValue(declaredValue(props, key));
    const family = indexedKey(key)?.[0];
    // ⛔ THE SAME RULE AS `judge`: createForm sends every declared key, so an unmanaged one (a
    //   cast-in `password`, `restore`/`force`, `hookscript`) is refused here or it is POSTed.
    if (!isManagedKey(key)) refuse.push(`${key}: not a config key this resource manages.`);
    if (value === '') continue;
    if (family === 'dev') refuse.push(rootOnly(props.vmid, key, value, 'Device passthrough.'));
    const volume = family === 'mp' || key === 'rootfs' ? parseVolume(value) : undefined;
    if (volume !== undefined && isHostPath(volume)) {
      refuse.push(rootOnly(props.vmid, key, value, 'A bind or device mount point.'));
    }
    if (volume?.kind === 'volume') refuse.push(existingVolume(key, value));
    if (key === 'features' && featuresNeedRoot('', value, unprivileged)) {
      refuse.push(rootOnly(props.vmid, key, value, featureWhy(unprivileged)));
    }
  }
  return refuse;
};

/** The create body: every declared key with a value, plus the create-time instructions. */
export const createForm = (props: LxcProps): Record<string, string> => {
  const form: Record<string, string> = { vmid: String(props.vmid) };
  if (props.ostemplate !== undefined) form['ostemplate'] = props.ostemplate;
  if (props.start !== undefined) form['start'] = wireValue(props.start);
  for (const key of declaredKeys(props)) {
    const value = wireValue(declaredValue(props, key));
    if (value === '') continue;
    form[key] = key === 'features' ? scalarForm(key, value) : value;
  }
  return form;
};
