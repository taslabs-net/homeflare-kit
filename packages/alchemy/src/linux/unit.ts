/**
 * `Systemd.Unit` and `Systemd.Timer` — one systemd unit file and systemd's view of it, declared.
 *
 * - create / update — write the unit file atomically, `daemon-reload`, enable or disable, then
 *   start, stop, or RESTART ONLY when something actually changed (unit-lifecycle.ts settle).
 * - read — the unit file's SHA-256 plus `systemctl show` (load state, active state, enablement).
 * - diff — the rendered digest against the stored AND the on-disk one, the declared enablement and
 *   running state against systemd's, and systemd's own `NeedDaemonReload`.
 * - replace — only when the unit's name or directory changes, and DELETE FIRST: two unit files for
 *   one name cannot both be the one systemd reads.
 * - delete — stop, disable, remove the file, reload.
 *
 * ⛔ A DEPLOY NEVER MASS-RESTARTS — see the ⛔ at the top of unit-lifecycle.ts. It is the property
 *   that lets this family reach a host holding a vault, a clock or a UPS handler.
 * ⛔ THE UNIT FILE IS NEVER A SECRET (unit-form.ts): it is 0644 and its props sit in state.
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt`. A unit already on the host reads as `Unowned`; adopting
 *   one that already matches the declaration does not restart it.
 * ★ TWO RESOURCES, ONE LIFECYCLE. A timer is a unit whose file ends `.timer` and carries a
 *   `[Timer]` section; splitting the TYPE rather than the code means a plan says which of the two
 *   a row is, and a `.service` declared as a timer is a refusal instead of a puzzle.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { HostRunnerService } from '../launchd/runner.ts';
import type { SystemdUnitAttributes, SystemdUnitProps } from './unit-form.ts';
import { deleteHandler, diffHandler, readHandler, reconcileHandler } from './unit-handlers.ts';

export type { SystemdUnitAttributes, SystemdUnitProps, UnitSection } from './unit-form.ts';

export interface SystemdUnit extends Resource<
  'Systemd.Unit',
  SystemdUnitProps,
  SystemdUnitAttributes
> {}

export interface SystemdTimer extends Resource<
  'Systemd.Timer',
  SystemdUnitProps,
  SystemdUnitAttributes
> {}

export const SystemdUnit = Resource<SystemdUnit>('Systemd.Unit');
export const SystemdTimer = Resource<SystemdTimer>('Systemd.Timer');

export const SystemdUnitProvider = () =>
  Provider.effect(
    SystemdUnit,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      return SystemdUnit.Provider.of({
        /**
         * ⛔ systemd's unit list is not a list of things this stack owns — it is every vendor,
         *   package and hand-written unit on the host. Returning them would invite a nuke to stop
         *   services nothing here declared.
         */
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => readHandler(runner, olds, output),
        diff: ({ instanceId, news, output }) => diffHandler(runner, instanceId, news, output),
        reconcile: (args) => reconcileHandler(runner, args),
        delete: ({ output }) => deleteHandler(runner, output),
      });
    }),
  );

export const SystemdTimerProvider = () =>
  Provider.effect(
    SystemdTimer,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      return SystemdTimer.Provider.of({
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => readHandler(runner, olds, output),
        // ★ `'timer'` is the whole difference: the same lifecycle, refusing a name that is not one.
        diff: ({ instanceId, news, output }) =>
          diffHandler(runner, instanceId, news, output, 'timer'),
        reconcile: (args) => reconcileHandler(runner, args, 'timer'),
        delete: ({ output }) => deleteHandler(runner, output),
      });
    }),
  );
