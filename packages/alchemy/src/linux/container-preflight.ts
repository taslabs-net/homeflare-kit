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
import { GENERATED_UNIT_DIRECTORY, isShadowingFragment } from './container-generator.ts';
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

/**
 * ⛔ A PLAIN UNIT SHARING THE SERVICE NAME CAN OUTRANK QUADLET'S GENERATOR, SILENTLY — but only
 *   when it sits in one of the directories that actually search BEFORE `${GENERATED_UNIT_DIRECTORY}`
 *   in systemd's own unit load path (systemd.unit(5) "Unit File Load Path") — `/etc/systemd/system`
 *   chief among them (`isShadowingFragment`, container-generator.ts, has the full list and the
 *   measured facts). ⛔ CORRECTED ON ADVERSARIAL RE-REVIEW: an EARLIER version of this check refused
 *   for ANY `FragmentPath` not literally under the generator directory, including the vendor
 *   directories (`/usr/local/lib/systemd/system`, `/usr/lib/systemd/system`) — those are LOWER
 *   precedence than the generator, not higher, so a plain unit there is harmlessly shadowed BY our
 *   generated unit once we write and reload; refusing for it was a false positive that blocked a
 *   create/adopt apply would have handled fine (exactly what S49 "neither looser nor stricter"
 *   forbids). With no `.container` file of ours on disk yet, a `FragmentPath` under one of the
 *   genuinely higher-precedence directories means some OTHER unit file — hand-written, or shipped by
 *   a package, and admin-controlled rather than vendor-controlled — already answers to this name:
 *   writing and reloading would generate a unit systemd never actually loads, because the
 *   higher-precedence plain one still wins.
 * ★ TWIN OF `unit-preflight.ts`'s `assertUnclaimed`, for the one failure mode `Systemd.Unit` can't
 *   have: there is no generator standing between ITS file and the unit systemd loads, so nothing
 *   there can be shadowed the way a Quadlet generation can.
 * ★ ONLY WHEN THE `.container` FILE ITSELF IS ABSENT (called from `readContainer` in that branch):
 *   a present file with different content is `assertUnclaimed`'s job; a present file that IS ours
 *   generating a shadowed unit is `verifyGenerated`'s job (container-generator.ts, hardened to check
 *   this same `FragmentPath` fact), at apply time, once daemon-reload has actually run — this is the
 *   "nothing declared yet" half neither of those covers, and the one this bug leaves refusing only
 *   mid-apply instead of at plan time for the directories that genuinely shadow.
 * ⚠️ NEVER FIRES WITHOUT A CONCRETE `fragmentPath` TO NAME, AND NEVER FOR A MASKED UNIT — MEASURED
 *   against this family's own fake (`fakeQuadletHost`, unlike `sudo-lifecycle.test.ts`'s, which is
 *   a different fake and reads differently): `placeUnit(path, text, {masked: true})` still reports
 *   a real `FragmentPath`. Refusing there anyway would work, but with THIS function's generic
 *   "plain unit" wording instead of `assertUsable`'s specific, more actionable "is masked, run
 *   `systemctl unmask` deliberately" — masking is a person's decision, not an accident to explain
 *   as a name collision. `assertUsable` stays the one place that message comes from.
 */
export const assertUnshadowed = (props: Pick<ContainerProps, 'name'>, status: UnitStatus): void => {
  if (!status.known || status.fragmentPath === undefined) return;
  if (status.loadState === 'masked' || status.unitFileState === 'masked') return;
  if (!isShadowingFragment(status.fragmentPath)) return;
  throw refuseContainer(
    props.name,
    `${serviceNameFor(props)} already exists as a plain unit at ${status.fragmentPath}, not a ` +
      `Quadlet generation — Quadlet's own output (${GENERATED_UNIT_DIRECTORY}/…) would be ` +
      'shadowed by it and never actually run: systemd loads the higher-precedence file first. ' +
      'Move the plain unit aside — a cutover — before declaring this container.',
  );
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
