/**
 * Everything `Podman.Container` checks before it touches the host — split from
 * container-lifecycle.ts so a reconcile and a plan-time REPLACE run the very same checks, exactly
 * the reason unit-preflight.ts exists (see that file's header; this mirrors it).
 *
 * ★ EVERY CHECK HERE IS READ-ONLY: validation, `systemctl show`, a file read and
 *   `HostRunner.checkWrite`. Nothing here writes, reloads or drives Podman.
 */
import { type HostRunner, canActAsRoot } from '../launchd/runner.ts';
import { UNIT_WRITE, digestOf } from './unit-form.ts';
import { type UnitStatus, showUnit } from './systemctl.ts';
import {
  type ContainerAttributes,
  type ContainerProps,
  containerPathFor,
  containerProblems,
  refuseContainer,
  renderContainerFile,
  serviceNameFor,
} from './container-form.ts';

const decoder = new TextDecoder();

/** Throw every refusal at once, so one plan shows the whole list. */
export const assertValid = (props: ContainerProps): void => {
  const found = containerProblems(props);
  if (found.length > 0) throw refuseContainer(props.name, found.join('; '));
};

/** ⛔ Writing the file and driving systemctl/Podman are root's — refuse up front, not mid-apply. */
export const assertMayWrite = (runner: HostRunner, name: string): void => {
  if (canActAsRoot(runner)) return;
  throw refuseContainer(
    name,
    'a Quadlet .container file is root-owned and daemon-reload/systemctl need root. Point the ' +
      'runner at a destination whose ssh user is root, or provide a privileged HostRunner. This ' +
      'provider never calls sudo.',
  );
};

/**
 * ⛔ A MASKED GENERATED UNIT IS SOMEONE'S DECISION, NOT DRIFT — same rule as `Systemd.Unit`
 *   (unit-preflight.ts `assertUsable`). Masking a generated unit is done the ordinary way, by
 *   symlinking its name to `/dev/null` in a directory Quadlet's generator output does not win
 *   against (`/etc/systemd/system` outranks `/run/systemd/generator`); unmasking here would
 *   silently overrule that.
 */
export const assertUsable = (props: Pick<ContainerProps, 'name'>, status: UnitStatus): void => {
  if (status.loadState === 'masked' || status.unitFileState === 'masked') {
    throw refuseContainer(
      props.name,
      `${serviceNameFor(props)} is masked. If that is stale, \`systemctl unmask\` it deliberately, ` +
        'then redeploy. Nothing was written.',
    );
  }
};

/**
 * ⛔ A `.container` FILE THIS RESOURCE DOES NOT OWN IS NEVER OVERWRITTEN — same rule and same
 *   exemption as `unit-preflight.ts`'s `assertUnclaimed`: a file byte-identical to our render is
 *   this declaration's own leftover, not someone else's.
 */
export const assertUnclaimed = async (runner: HostRunner, props: ContainerProps): Promise<void> => {
  const path = containerPathFor(props);
  const bytes = await runner.readFile(path);
  const live = bytes === undefined ? undefined : digestOf(decoder.decode(bytes));
  if (live !== undefined && live !== digestOf(renderContainerFile(props))) {
    throw refuseContainer(
      props.name,
      `${path} is already on this host and is not this resource. Remove it, or declare it as a ` +
        'new resource and deploy with --adopt.',
    );
  }
};

/** The half of a rename check that needs only the NEW NAME — mirrors `assertRenameTarget`. */
export const assertRenameTarget = async (
  runner: HostRunner,
  old: ContainerAttributes,
  name: string,
): Promise<void> => {
  assertMayWrite(runner, old.name);
  assertMayWrite(runner, name);
  assertUsable({ name }, await showUnit(runner, serviceNameFor({ name })));
};

/** A rename, checked at plan time, before the plan may promise a delete-first replace. */
export const assertReplaceable = async (
  runner: HostRunner,
  next: ContainerProps,
  old: ContainerAttributes,
): Promise<void> => {
  assertValid(next);
  await assertRenameTarget(runner, old, next.name);
  await assertUnclaimed(runner, next);
  await runner.checkWrite?.(containerPathFor(next), UNIT_WRITE);
};
