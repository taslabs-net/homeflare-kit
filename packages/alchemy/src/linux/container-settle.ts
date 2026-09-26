/**
 * The step that decides whether the GENERATED `<name>.service` actually moves: running state and —
 * only for a real change — a restart. Split out for the same reason unit-settle.ts is split from
 * unit-lifecycle.ts: it is the restart contract, and it should be readable on its own.
 *
 * ⛔ THE RESTART CONDITION IS THE WHOLE CONTRACT, same as `Systemd.Unit`'s (unit-settle.ts):
 *   `changed` comes from the caller (container-lifecycle.ts `reconcileContainer`), `configChanged`
 *   is a digest the DECLARATION itself listed. Nothing else restarts a container.
 * ★ NO ENABLE/DISABLE HERE — the one place this file is SHORTER than unit-settle.ts, not longer.
 *   Quadlet's generator applies `[Install]` itself on every `daemon-reload` (container-generator.ts
 *   header); calling `systemctl enable`/`disable` on a generated unit does not work at all (same
 *   header, doc-cited). So there is no enablement branch to settle — only started/stopped and the
 *   restart-on-change rule.
 */
import type { HostRunner } from '../launchd/runner.ts';
import { isUnitRunning } from './unit-form.ts';
import {
  type UnitStatus,
  daemonReload,
  restartUnit,
  showUnit,
  startUnit,
  stopUnit,
} from './systemctl.ts';
import {
  type ContainerAttributes,
  type ContainerProps,
  refuseContainer,
} from './container-form.ts';

export const attributesOf = (
  props: ContainerProps,
  configSha256: string,
  containerSha256: string,
  containerPath: string,
  serviceName: string,
  status: UnitStatus,
): ContainerAttributes => ({
  active: status.activeState === 'active' || status.activeState === 'activating',
  activeState: status.activeState,
  configSha256,
  containerPath,
  containerSha256,
  loadState: status.loadState,
  name: props.name,
  serviceName,
  ...(status.unitFileState === undefined ? {} : { unitFileState: status.unitFileState }),
  ...(status.sourcePath === undefined ? {} : { sourcePath: status.sourcePath }),
});

export type Settle = {
  readonly before: Uint8Array | undefined;
  /** The `.container` file or systemd's view of it changed in a way that earns a restart. */
  readonly changed: boolean;
  readonly configChanged: boolean;
  readonly desired: string;
  readonly path: string;
  readonly serviceName: string;
  readonly status: UnitStatus;
};

/**
 * Bring running state to the declaration, restarting ONLY for a real change. No enable/disable —
 * see file header.
 */
export const settle = async (
  runner: HostRunner,
  props: ContainerProps,
  configSha256: string,
  step: Settle,
): Promise<ContainerAttributes> => {
  const wantStarted = props.started !== false;
  const running = isUnitRunning(step.status.activeState, step.status.subState, wantStarted);
  const undo = async (detail: string): Promise<never> => {
    // ⚠️ A create that never came up leaves nothing behind; an update keeps the new file — the
    //   generator-verification step already ran (container-lifecycle.ts) by the time settle is
    //   called, so the unit DOES exist here; only the start/restart itself failed.
    if (step.before === undefined) {
      await runner.removeFile(step.path).catch(() => undefined);
      await daemonReload(runner).catch(() => undefined);
    }
    // 🔴 MEASURED FALSE, CT100 deploy 2026-09-26 00:11Z: this suffix used to assert "is NOT
    //   running" unconditionally — even for a `detail` that was a REFUSAL before sudo ever ran
    //   (the sudo ownership check on a Quadlet unit, say), where nothing about the running
    //   container was touched. `caddy` stayed active/running through the whole failed deploy.
    //   State only what this call actually knows: read the live state back, best-effort, rather
    //   than assert either way.
    const after = await showUnit(runner, step.serviceName).catch(() => undefined);
    const stateNote =
      after === undefined
        ? 'Its running state was not re-checked.'
        : `Its unit is now ${after.activeState}.`;
    throw refuseContainer(props.name, `${detail} ${stateNote}`);
  };
  try {
    if (!wantStarted) {
      if (running) await stopUnit(runner, step.serviceName);
    } else if (!running) await startUnit(runner, step.serviceName);
    else if (step.changed || step.configChanged) await restartUnit(runner, step.serviceName);
  } catch (cause) {
    return undo(cause instanceof Error ? cause.message : String(cause));
  }
  const after = await showUnit(runner, step.serviceName);
  if (wantStarted && !isUnitRunning(after.activeState, after.subState, wantStarted)) {
    return undo(`systemctl reported success but the unit is ${after.activeState}.`);
  }
  return attributesOf(props, configSha256, step.desired, step.path, step.serviceName, after);
};
