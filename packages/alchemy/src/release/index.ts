/**
 * Release binaries for Alchemy — one binary out of a pinned release archive, installed onto a host
 * and verified against digests the stack pins in code, plus the vendor data sets those pins come
 * from (VictoriaMetrics' is the first).
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, AND IT IS DELIBERATELY SMALLER THAN THE DIRECTORY. The tar
 *   reader, the downloader, the checksum parser, the lifecycle and the test seams are internals; an
 *   `export *` would publish them as API and make the next refactor a breaking change.
 * ⛔ IT INSTALLS; IT NEVER STARTS. Run the binary with `LaunchdJob` (the launchd subpath) or a
 *   systemd unit, putting `ReleaseBinary`'s `path` in its argv. See docs/release-binary.md.
 * ★ THE SEAM IS SHARED, NOT COPIED. `HostRunner` is re-exported so a stack types its runner without
 *   importing from another subpath.
 */
export type {
  PinnedDownload,
  ReleaseArchive,
  ReleaseBinaryAttributes,
  ReleaseBinaryProps,
} from './binary-form.ts';
export { releaseBinaryPath, releaseUrl } from './binary-form.ts';
export { ReleaseBinary, ReleaseBinaryProvider } from './binary.ts';
export type {
  CatalogPackage,
  CatalogRequest,
  IdentifiedBinary,
  PinnedArchive,
  PinnedBinary,
  ReleaseCatalog,
} from './catalog.ts';
export { catalogBinary, catalogDirectory, catalogProblems, identifyBinary } from './catalog.ts';
export { releaseProviders } from './providers.ts';
export { ArchiveRefused, BinaryRefused, ChecksumMismatch, DownloadFailed } from './refused.ts';
export { VICTORIA_RELEASES } from './victoria.ts';
export type {
  ExecResult,
  FileStat,
  HostRunner,
  HostUser,
  WriteOptions,
} from '../launchd/runner.ts';
export { HostRunnerService, hostRunnerLayer } from '../launchd/runner.ts';
