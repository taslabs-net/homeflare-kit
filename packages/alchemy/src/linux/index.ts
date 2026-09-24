/**
 * Linux host providers for Alchemy — a host's directories, its files (whole, or one managed block
 * inside somebody else's file), its systemd units and its Podman Quadlet containers, over the SAME
 * HostRunner seam the launchd subpath drives a Mac through.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. The lifecycle
 *   files, the systemctl parsers and the fake host are internals; an `export *` would publish them
 *   as API and make the next refactor a breaking change.
 * ⛔ A DEPLOY NEVER MASS-RESTARTS: a unit is restarted only when its own file changed, or a digest
 *   the declaration listed changed. See docs/linux-host.md and docs/quadlet-container.md.
 * ★ THE SEAM IS SHARED, NOT COPIED. `HostRunner` is re-exported here so a Linux stack never has to
 *   import from the launchd subpath to type its own runner.
 */
export type { HostDirectoryAttributes, HostDirectoryProps } from './directory-lifecycle.ts';
export { HostDirectory, HostDirectoryProvider } from './directory.ts';
export { linuxProviders } from './providers.ts';
export type { RegionSpec } from './region.ts';
export type { RemoteFileAttributes, RemoteFileProps } from './remote-file-form.ts';
export { RemoteFile, RemoteFileProvider } from './remote-file.ts';
export type { SshRunnerOptions } from './ssh-runner.ts';
export { sshRunner } from './ssh-runner.ts';
export type { SshSudoRunnerOptions } from './sudo-runner.ts';
export { sshSudoRunner } from './sudo-runner.ts';
export type {
  ExecResult,
  FileStat,
  HostRunner,
  HostUser,
  WriteOptions,
} from '../launchd/runner.ts';
export { HostRunnerService, canActAsRoot, hostRunnerLayer } from '../launchd/runner.ts';
export type { SystemdUnitAttributes, SystemdUnitProps, UnitSection } from './unit-form.ts';
export { DEFAULT_UNIT_DIRECTORY, renderUnit } from './unit-form.ts';
export { SystemdTimer, SystemdTimerProvider, SystemdUnit, SystemdUnitProvider } from './unit.ts';
export type {
  ContainerSection,
  PodmanContainerAttributes,
  PodmanContainerProps,
  PodmanUnitLine,
} from './container.ts';
// ★ `renderContainerFile`/`containerPathFor` are the pure `.container` file renderer and its path
//   rule — the same kind of pure helper `renderUnit`/`DEFAULT_UNIT_DIRECTORY` above already are
//   for `Systemd.Unit`. A consumer needs these to prove ITS OWN declared props render into the
//   directive set it expects (an equivalence/fixture test against a live host), the same way this
//   package's own container-fixture.test.ts does internally — without them, a consuming repo has
//   no import path to the real renderer and has to reimplement it to write that test at all
//   (found: homeflare-ct100 PR #1). `containerProblems`/`refuseContainer`/`serviceNameFor` stay
//   internal — no consumer need for those was raised, and validation/naming internals are a wider
//   surface to commit to than one pure render function.
export {
  containerPathFor,
  QUADLET_DEFAULT_DIRECTORY,
  QUADLET_SEARCH_DIRECTORIES,
  renderContainerFile,
} from './container-form.ts';
export { PodmanContainer, PodmanContainerProvider } from './container.ts';
