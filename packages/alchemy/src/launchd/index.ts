/**
 * launchd providers for Alchemy — declare a Mac host's jobs and their config files.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. The
 *   lifecycle files, the launchctl parsers and the fake runner are internals; an `export *` would
 *   publish them as API and make the next refactor a breaking change.
 * ⛔ macOS HOSTS ONLY for LaunchdJob. HostFile and the runner work on any POSIX host, but the
 *   subpath exists for the Mac: see docs/launchd.md for the cutover from nix-darwin.
 */
export type { HostFileAttributes, HostFileProps } from './host-file.ts';
export { HostFile, HostFileProvider } from './host-file.ts';
export type {
  CalendarInterval,
  KeepAlive,
  LaunchdDomain,
  LaunchdJobAttributes,
  LaunchdJobProps,
} from './job.ts';
export { LaunchdJob, LaunchdJobProvider } from './job.ts';
export type { LocalRunnerOptions } from './local-runner.ts';
export { localRunner } from './local-runner.ts';
export type { PlistDict, PlistValue } from './plist.ts';
export { PlistError, renderPlist } from './plist.ts';
export type { PortClaim } from './port-claims.ts';
export { PortRefused, claimPorts, portClaimProblems } from './port-claims.ts';
export { launchdProviders } from './providers.ts';
export type { ExecResult, FileStat, HostRunner, HostUser, WriteOptions } from './runner.ts';
export { HostRunnerService, canActAsRoot, hostRunnerLayer } from './runner.ts';
export type { SudoRunnerOptions } from './sudo-runner.ts';
export { SudoRefusedError, sudoRunner } from './sudo-runner.ts';
