/**
 * Release.Binary's read / reconcile / delete as plain async functions over a HostRunner and a
 * FetchArchive, so the lifecycle runs against fakes of both in tests. (diff: binary-diff.ts.)
 *
 * ⛔ ONE WRITER. The verified bytes reach the host through file-converge.ts — the path Host.File's
 *   bytes take — and so through `HostRunner.writeFileAtomic` alone: a temp file in the same
 *   directory, mode and owner set, rename. Under sudoRunner that is its staged `install -S`.
 *   Nothing here opens a file, spawns `tar`, or stages a download on disk.
 * ★ REFUSE BEFORE TOUCHING ANYTHING. Validation runs before the first host call, the host checks
 *   run before the first download, and the digest checks run before the one write — so every
 *   refusal but a failed read-back can say "Nothing was written."
 * ★ AN INSTALLED BINARY IS RECOGNISED BY ITS DIGEST. A file whose SHA-256 is the pin needs no
 *   download to confirm, and a mode or owner fix re-writes the bytes already on disk.
 */
import {
  type FileTarget,
  convergeFile,
  readFileAttributes,
  removeWholeFile,
  resolveIds,
} from '../launchd/file-converge.ts';
import type { HostFileAttributes } from '../launchd/host-file-form.ts';
import { sha256Hex } from '../launchd/job-form.ts';
import type { HostRunner } from '../launchd/runner.ts';
import { verifiedMember } from './archive.ts';
import {
  DEFAULT_BINARY_MODE,
  type PinnedDownload,
  type ReleaseBinaryAttributes,
  type ReleaseBinaryProps,
  binaryProblems,
  inPlaceRefusal,
  pinnedDownload,
  pinsMoved,
  releaseBinaryPath,
} from './binary-form.ts';
import type { FetchArchive } from './download.ts';
import { ArchiveRefused, BinaryRefused, ChecksumMismatch, DownloadFailed } from './refused.ts';

export const NOTHING = 'Nothing was written.';

export const refuse = (path: string, message: string): BinaryRefused =>
  new BinaryRefused({ message: `Release.Binary ${path}: ${message}` });

/** Re-say a download or archive failure as this resource's, keeping its tag. */
const restated = (path: string, cause: unknown): unknown => {
  const say = (message: string) => `Release.Binary ${path}: ${message}. ${NOTHING}`;
  if (cause instanceof ChecksumMismatch) {
    const { actual, expected, subject } = cause;
    return new ChecksumMismatch({ actual, expected, message: say(cause.message), subject });
  }
  if (cause instanceof ArchiveRefused) return new ArchiveRefused({ message: say(cause.message) });
  if (cause instanceof DownloadFailed) {
    return new DownloadFailed({ message: say(cause.message), retryable: cause.retryable });
  }
  return cause;
};

export type Desired = { readonly want: FileTarget; readonly download: PinnedDownload };

/** Validate every prop, then resolve owner and group through the runner. */
export const desiredBinary = async (
  runner: HostRunner,
  props: ReleaseBinaryProps,
): Promise<Desired> => {
  const path = releaseBinaryPath(props);
  const problems = binaryProblems(props);
  if (problems.length > 0) throw refuse(path, `${problems.join('; ')}. ${NOTHING}`);
  const ids = await resolveIds(runner, props, path, refuse);
  const mode = props.mode ?? DEFAULT_BINARY_MODE;
  return { download: pinnedDownload(props), want: { mode, path, sha256: props.sha256, ...ids } };
};

const withSource = (
  found: HostFileAttributes,
  download: PinnedDownload,
): ReleaseBinaryAttributes => ({ ...found, member: download.member, url: download.url });

/**
 * The file at the declaration's path, or undefined when absent — the adoption probe's answer.
 * ★ Its `sha256` is the digest of the bytes on disk, so a caller sees at once whether it is the
 *   pinned binary (equal to `props.sha256`) without anything being executed.
 */
export const readBinary = async (
  runner: HostRunner,
  props: ReleaseBinaryProps,
): Promise<ReleaseBinaryAttributes | undefined> => {
  const { download, want } = await desiredBinary(runner, props);
  const found = await readFileAttributes(runner, want.path);
  return found === undefined ? undefined : withSource(found, download);
};

/** An owned binary as it is now, at the path state recorded — no pins needed to find it. */
export const refreshBinary = async (
  runner: HostRunner,
  output: ReleaseBinaryAttributes,
): Promise<ReleaseBinaryAttributes | undefined> => {
  const found = await readFileAttributes(runner, output.path);
  return found === undefined ? undefined : { ...found, member: output.member, url: output.url };
};

/**
 * ⛔ THE DIRECTORY IS DECLARED, NEVER INVENTED. Checked before any download: a missing directory
 *   would otherwise cost 123 MB and then fail at the write. A symlink is refused as well — the
 *   write would land wherever it points, under an owner nobody declared.
 */
const directoryReady = async (runner: HostRunner, props: ReleaseBinaryProps): Promise<void> => {
  const stat = await runner.stat(props.directory);
  if (stat?.kind === 'directory') return;
  const why = stat === undefined ? 'does not exist' : `is a ${stat.kind}, not a directory`;
  throw refuse(
    releaseBinaryPath(props),
    `directory ${props.directory} ${why}; declare it (HostDirectory) and pass its path. ${NOTHING}`,
  );
};

export type ReconcileOptions = {
  /** The attributes state holds; undefined on a create. */
  readonly output?: ReleaseBinaryAttributes | undefined;
  /** The props state holds; undefined on a create and on an adoption. */
  readonly olds?: ReleaseBinaryProps | undefined;
  /** adoptsAtApply's answer. What it may take over is convergeFile's ⛔. @default false */
  readonly adopt?: boolean;
  /** Progress for the deploy log — the engine's `session.note`. */
  readonly note?: (message: string) => Promise<void>;
  /**
   * What is wrong with the pins as the stack program DECLARED them (declared-pins.ts) — an Output
   * there resolves to a plausible plain string by the time it reaches `props`. @default []
   */
  readonly declared?: readonly string[];
};

/** Install the declared binary unless it is already there, and return it as read back. */
export const reconcileBinary = async (
  runner: HostRunner,
  fetch: FetchArchive,
  props: ReleaseBinaryProps,
  options: ReconcileOptions = {},
): Promise<ReleaseBinaryAttributes> => {
  const { adopt = false, declared = [], note = async () => undefined } = options;
  // ⛔ FIRST, before any host call: a digest the deploy computed is a fetch by another name.
  if (declared.length > 0) {
    throw refuse(
      releaseBinaryPath(props),
      `${declared.join('; ')}. A pin is copied into reviewed code, never computed during the ` +
        `deploy (declared-pins.ts). ${NOTHING}`,
    );
  }
  const { download, want } = await desiredBinary(runner, props);
  // ⛔ The apply-time half of binary-diff.ts's in-place refusal, for an update whose `olds` say so.
  const olds = options.olds;
  if (olds !== undefined && releaseBinaryPath(olds) === want.path && pinsMoved(olds, props)) {
    throw refuse(want.path, `${inPlaceRefusal(olds, props)}. ${NOTHING}`);
  }
  await directoryReady(runner, props);
  const bytesFor = async (before: HostFileAttributes | undefined): Promise<Uint8Array> => {
    // ★ The right bytes with the wrong mode or owner: re-write what is there, re-hashed, rather
    //   than download 123 MB to get the same bytes back.
    if (before?.sha256 === want.sha256) {
      const local = await runner.readFile(want.path);
      if (local !== undefined && sha256Hex(local) === want.sha256) return local;
    }
    await note(`downloading ${download.url} (${String(download.size)} bytes)`);
    try {
      const bytes = await verifiedMember(await fetch(download.url, download.size), download);
      await note(`verified ${download.member} ${download.memberSha256}`);
      return bytes;
    } catch (cause) {
      throw restated(want.path, cause);
    }
  };
  const spec = { bytesFor, owner: props.owner, refuse, want };
  return withSource(await convergeFile(runner, spec, options.output, adopt), download);
};

/** Remove the binary. Idempotent. ⛔ Refuses a path that has since become a symlink or directory. */
export const deleteBinary = (runner: HostRunner, output: ReleaseBinaryAttributes): Promise<void> =>
  removeWholeFile(runner, output, refuse);
