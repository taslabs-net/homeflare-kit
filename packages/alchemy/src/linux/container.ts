/**
 * `Podman.Container` — one Quadlet `.container` file, declared, plus the systemd unit Podman's own
 * generator turns it into.
 *
 * - create / update — render, write the `.container` file atomically, `daemon-reload`, VERIFY the
 *   generator actually produced `<name>.service` (container-generator.ts), then start or RESTART
 *   the generated unit only when something changed (container-lifecycle.ts, container-settle.ts).
 * - read — the `.container` file's SHA-256 plus `systemctl show <name>.service`.
 * - diff — the rendered digest against stored and on-disk, running state against the declaration,
 *   and systemd's own `NeedDaemonReload`.
 * - replace — only when the file's name or directory changes, delete-first.
 * - delete — stop the generated unit, remove the `.container` file, reload.
 *
 * ⛔ A DEPLOY NEVER MASS-RESTARTS — see container-lifecycle.ts's header.
 * ⛔ THE `.container` FILE IS NEVER A SECRET, and `[Container] Environment=` is refused if it looks
 *   like one — see container-form.ts and container-secrets.ts.
 * ⛔ THE GENERATED UNIT IS NEVER `systemctl enable`D — see container-generator.ts's header for why,
 *   measured and doc-cited, and what stands in for it (`install.wantedBy`).
 * ⚠️ NOTHING IS ADOPTED WITHOUT `--adopt` — same contract as every family here.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { HostRunnerService } from '../launchd/runner.ts';
import type { ContainerAttributes, ContainerProps } from './container-form.ts';
import { deleteHandler, diffHandler, readHandler, reconcileHandler } from './container-handlers.ts';

export type {
  ContainerAttributes as PodmanContainerAttributes,
  ContainerProps as PodmanContainerProps,
  ContainerSection,
  UnitLine as PodmanUnitLine,
} from './container-form.ts';

export interface PodmanContainer extends Resource<
  'Podman.Container',
  ContainerProps,
  ContainerAttributes
> {}

export const PodmanContainer = Resource<PodmanContainer>('Podman.Container');

export const PodmanContainerProvider = () =>
  Provider.effect(
    PodmanContainer,
    Effect.gen(function* () {
      const runner = yield* HostRunnerService;
      return PodmanContainer.Provider.of({
        /**
         * ⛔ Same rule as `Systemd.Unit`'s `list` (unit.ts): systemd's unit list is every vendor,
         *   package and hand-written unit on the host, not what this stack owns.
         */
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => readHandler(runner, olds, output),
        diff: ({ instanceId, news, output }) => diffHandler(runner, instanceId, news, output),
        reconcile: (args) => reconcileHandler(runner, args),
        delete: ({ output }) => deleteHandler(runner, output),
      });
    }),
  );
