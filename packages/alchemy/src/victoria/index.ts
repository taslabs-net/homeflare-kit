/**
 * Victoria providers for Alchemy — the VictoriaMetrics family's binaries, installed from the
 * vendor's release archives and verified against digests pinned in the kit.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. The tar
 *   reader, the downloader, the lifecycle and the test seams are internals; an `export *` would
 *   publish them as API and make the next refactor a breaking change.
 * ⛔ IT INSTALLS; IT NEVER STARTS. Run the binary with `LaunchdJob` (the launchd subpath) or a
 *   systemd unit, putting `VictoriaBinary`'s `path` in its argv. See docs/victoria.md.
 * ★ THE SEAM IS SHARED, NOT COPIED. `HostRunner` is re-exported so a stack types its runner without
 *   importing from another subpath.
 */
export type { VictoriaBinaryAttributes, VictoriaBinaryProps } from './binary-form.ts';
export { victoriaBinaryPath, victoriaDirectory } from './binary-form.ts';
export { VictoriaBinary, VictoriaBinaryProvider } from './binary.ts';
export type {
  PinnedArchive,
  VictoriaCatalog,
  VictoriaPackage,
  VictoriaPackageEntry,
  VictoriaPlatform,
} from './catalog.ts';
export { VICTORIA_CATALOG } from './catalog.ts';
export { victoriaProviders } from './providers.ts';
export { ArchiveRefused, BinaryRefused, ChecksumMismatch, DownloadFailed } from './refused.ts';
export type { IdentifiedBinary, ResolvedRelease, VictoriaRequest } from './release.ts';
export { identifyVictoriaBinary, releaseProblems, resolveVictoriaRelease } from './release.ts';
export type {
  ExecResult,
  FileStat,
  HostRunner,
  HostUser,
  WriteOptions,
} from '../launchd/runner.ts';
export { HostRunnerService, hostRunnerLayer } from '../launchd/runner.ts';
