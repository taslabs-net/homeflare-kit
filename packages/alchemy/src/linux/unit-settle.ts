/**
 * The step that decides whether anything on the host actually moves: enablement, running state and
 * — only for a real change — a restart. Split from unit-lifecycle.ts because it is the rule the
 * whole family exists to keep, and it should be readable on its own.
 *
 * ⛔ THE RESTART CONDITION IS THE WHOLE CONTRACT. `changed` is set by the caller from the four
 *   things that earn one (unit-lifecycle.ts reconcileUnit); `configChanged` is a digest the
 *   DECLARATION itself listed. Nothing else restarts a unit — not a re-run, not an unrelated
 *   resource in the same deploy, not `--adopt`.
 */
import type { HostRunner } from '../launchd/runner.ts';
import {
  type SystemdUnitAttributes,
  type SystemdUnitProps,
  configDigest,
  isUnitRunning,
  unitPathFor,
} from './unit-form.ts';
import {
  type UnitStatus,
  daemonReload,
  disableUnit,
  enableUnit,
  restartUnit,
  showUnit,
  startUnit,
  stopUnit,
} from './systemctl.ts';

export const refuse = (name: string, message: string): Error =>
  new Error(`Systemd.Unit ${name}: ${message}`);

export const attributesOf = (
  props: SystemdUnitProps,
  unitSha256: string,
  status: UnitStatus,
): SystemdUnitAttributes => ({
  active: status.activeState === 'active' || status.activeState === 'activating',
  activeState: status.activeState,
  configSha256: configDigest(props.restartOn),
  enabled: status.unitFileState === 'enabled' || status.unitFileState === 'enabled-runtime',
  loadState: status.loadState,
  name: props.name,
  unitPath: unitPathFor(props),
  unitSha256,
  ...(status.unitFileState === undefined ? {} : { unitFileState: status.unitFileState }),
});

export type Settle = {
  readonly before: Uint8Array | undefined;
  /** The unit file or systemd's view of it changed in a way that earns a restart. */
  readonly changed: boolean;
  readonly configChanged: boolean;
  readonly desired: string;
  readonly path: string;
  readonly status: UnitStatus;
};

/**
 * Bring enablement and running state to the declaration, restarting ONLY for a real change.
 * ⛔ THE RESTART CONDITION IS THE WHOLE CONTRACT: the unit file changed, or a digest the caller
 *   listed changed. Nothing else — not a re-run, not an unrelated resource, not `--adopt`.
 */
export const settle = async (
  runner: HostRunner,
  props: SystemdUnitProps,
  step: Settle,
): Promise<SystemdUnitAttributes> => {
  const wantEnabled = props.enabled !== false;
  const wantStarted = props.started !== false;
  const isEnabled =
    step.status.unitFileState === 'enabled' || step.status.unitFileState === 'enabled-runtime';
  const undo = async (detail: string): Promise<never> => {
    // ⚠️ A create that never came up leaves nothing behind; an update keeps the new file and the
    //   old stored digest, so the next deploy retries.
    if (step.before === undefined) {
      await runner.removeFile(step.path).catch(() => undefined);
      await daemonReload(runner).catch(() => undefined);
    }
    throw refuse(props.name, `${detail} The unit is NOT running.`);
  };
  try {
    if (wantEnabled && (!isEnabled || step.changed)) await enableUnit(runner, props.name);
    if (!wantEnabled && isEnabled) await disableUnit(runner, props.name);
    // ★ isUnitRunning (unit-form.ts): the same started-aware policy diffUnit uses, so a unit this
    //   deploy never touches — a `started: false` oneshot mid-run — is never stopped here either.
    //   `subState` is what tells that mid-run apart from a crash-restart backoff, which still stops.
    const running = isUnitRunning(step.status.activeState, step.status.subState, wantStarted);
    if (!wantStarted) {
      if (running) await stopUnit(runner, props.name);
    } else if (!running) await startUnit(runner, props.name);
    else if (step.changed || step.configChanged) await restartUnit(runner, props.name);
  } catch (cause) {
    return undo(cause instanceof Error ? cause.message : String(cause));
  }
  /**
   * ⚠️ READ BACK, never echo the declaration. Returning `enabled: wantEnabled` because we called
   *   `enable` would put a CLAIM in state instead of a reading, and the next plan would compare
   *   the declaration against itself — so a link systemd did not actually make would never show up
   *   as drift, in either direction.
   */
  const after = await showUnit(runner, props.name);
  if (wantStarted && !isUnitRunning(after.activeState, after.subState, wantStarted)) {
    return undo(`systemctl reported success but the unit is ${after.activeState}.`);
  }
  const settled = attributesOf(props, step.desired, after);
  if (wantEnabled && !settled.enabled) {
    return undo(
      `systemctl enable reported success but systemd calls the unit ` +
        `${JSON.stringify(after.unitFileState ?? '')}, not enabled.`,
    );
  }
  return settled;
};
