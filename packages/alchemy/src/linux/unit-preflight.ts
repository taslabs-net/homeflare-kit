/**
 * Everything Systemd.Unit checks before it touches the host — split from unit-lifecycle.ts so that
 * a reconcile and a plan-time REPLACE run the very same checks.
 *
 * ★ WHY A REPLACE IS CHECKED AT PLAN TIME. A name or directory change is a delete-first replace,
 *   and Alchemy runs `delete` on the old unit BEFORE `reconcile` on the new one (Apply.ts,
 *   deleteOldGenerations under `node.deleteFirst`). A refusal that fired only in reconcile would
 *   therefore arrive after the old unit was already stopped and its file removed: nothing running,
 *   and a plan that had promised a clean swap.
 * ★ EVERY CHECK HERE IS READ-ONLY. systemd has no `print-disabled` equivalent in this family —
 *   masking is `systemctl show`'s LoadState / UnitFileState, which `showUnit` already returns.
 *   Validation, that show, a file read and `HostRunner.checkWrite` write nothing. `systemctl
 *   enable` itself stays an apply step; the ways it is known to fail (no `[Install]`, a directory
 *   systemd does not search) are `unitProblems`, checked here before the plan may promise a swap.
 */
import { type HostRunner, canActAsRoot } from '../launchd/runner.ts';
import { type UnitStatus, showUnit } from './systemctl.ts';
import {
  type SystemdUnitAttributes,
  type SystemdUnitProps,
  UNIT_WRITE,
  digestOf,
  unitPathFor,
  unitProblems,
  unitText,
} from './unit-form.ts';
import { refuse } from './unit-settle.ts';

const decoder = new TextDecoder();

/** Throw every refusal at once, so one plan shows the whole list. */
export const assertValid = (props: SystemdUnitProps, expect?: string): void => {
  const found = unitProblems(props, expect);
  if (found.length > 0) throw refuse(props.name, found.join('; '));
};

/** ⛔ Writing a unit file and driving systemd are root's, so refuse up front rather than mid-apply. */
export const assertMayWrite = (runner: HostRunner, name: string): void => {
  if (canActAsRoot(runner)) return;
  throw refuse(
    name,
    'a systemd unit is root-owned and systemctl needs root. Point the runner at a destination ' +
      'whose ssh user is root, or provide a privileged HostRunner. This provider never calls sudo.',
  );
};

/**
 * ⛔ A MASKED UNIT IS SOMEONE'S DECISION, NOT DRIFT. `systemctl mask` survives reboots and makes
 *   start fail; unmasking here would silently overrule whoever masked it.
 */
export const assertUsable = (props: Pick<SystemdUnitProps, 'name'>, status: UnitStatus): void => {
  if (status.loadState === 'masked' || status.unitFileState === 'masked') {
    throw refuse(
      props.name,
      'is masked. If that is stale, `systemctl unmask` it deliberately, then redeploy. Nothing ' +
        'was written.',
    );
  }
};

/**
 * ⛔ A UNIT THIS RESOURCE DOES NOT OWN IS NEVER OVERWRITTEN. Alchemy's adoption probe guards a
 *   create, but NOT the new name of a replace — the engine reads nothing there — so a rename onto
 *   a unit file someone else already has would stop the old unit and write ours over theirs.
 * ★ A file byte-identical to our render is exempt: it is this declaration's own leftover (a deploy
 *   that died between write and reload), and rewriting it changes nothing.
 */
export const assertUnclaimed = async (
  runner: HostRunner,
  props: SystemdUnitProps,
): Promise<void> => {
  const path = unitPathFor(props);
  const bytes = await runner.readFile(path);
  const live = bytes === undefined ? undefined : digestOf(decoder.decode(bytes));
  if (live !== undefined && live !== digestOf(unitText(props))) {
    throw refuse(
      props.name,
      `${path} is already on this host and is not this resource. Remove it, or declare it as a ` +
        'new resource and deploy with --adopt.',
    );
  }
};

/**
 * The half of a rename check that needs only the NEW NAME: the old unit deletable, the new one
 * writable and not masked.
 * ★ ON ITS OWN it is for the rename unit-handlers.ts `diffHandler` spots while `content` is still
 *   an Output. That plan is a delete-first replace too, so a masked target refused only in
 *   reconcile would again arrive after the old unit was stopped. The unit file itself cannot be
 *   compared until `content` resolves, so `assertUnclaimed` stays reconcile's job there.
 */
export const assertRenameTarget = async (
  runner: HostRunner,
  old: SystemdUnitAttributes,
  name: string,
): Promise<void> => {
  assertMayWrite(runner, old.name);
  assertMayWrite(runner, name);
  assertUsable({ name }, await showUnit(runner, name));
};

/**
 * A rename, checked at plan time: the new identity must be valid, writable, not masked and free,
 * and the old one deletable — before the plan may promise a delete-first replace.
 */
export const assertReplaceable = async (
  runner: HostRunner,
  next: SystemdUnitProps,
  old: SystemdUnitAttributes,
  expect?: string,
): Promise<void> => {
  assertValid(next, expect);
  await assertRenameTarget(runner, old, next.name);
  await assertUnclaimed(runner, next);
  await runner.checkWrite?.(unitPathFor(next), UNIT_WRITE);
};
