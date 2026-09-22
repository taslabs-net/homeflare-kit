/**
 * Victoria.Binary's read / diff / reconcile / delete as plain async functions over a HostRunner
 * and a FetchArchive, so the lifecycle runs against fakes of both in tests.
 *
 * ⛔ ONE WRITER. The verified bytes reach the host through file-converge.ts — the path Host.File's
 *   bytes take — and so through `HostRunner.writeFileAtomic` alone: a temp file in the same
 *   directory, mode and owner set, rename. Under sudoRunner that is its staged `install -S`.
 *   Nothing here opens a file, spawns `tar`, or stages a download on disk.
 * ★ REFUSE BEFORE TOUCHING ANYTHING. Validation (the catalog included) runs before the first host
 *   call, the host checks run before the first download, and the digest checks run before the one
 *   write — so every refusal but a failed read-back can say "Nothing was written."
 * ★ AN INSTALLED BINARY IS RECOGNISED BY ITS DIGEST. A file whose SHA-256 is the catalog's pin
 *   needs no download to confirm, and a mode or owner fix re-writes the bytes already on disk.
 */
import type { Diff } from 'alchemy/Diff';
import {
  type FileTarget,
  convergeFile,
  diffTarget,
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
  type VictoriaBinaryAttributes,
  type VictoriaBinaryProps,
  binaryProblems,
  victoriaBinaryPath,
} from './binary-form.ts';
import { VICTORIA_CATALOG, type VictoriaCatalog } from './catalog.ts';
import type { FetchArchive } from './download.ts';
import { ArchiveRefused, BinaryRefused, ChecksumMismatch, DownloadFailed } from './refused.ts';
import { type ResolvedRelease, resolveVictoriaRelease } from './release.ts';

const NOTHING = 'Nothing was written.';

const refuse = (path: string, message: string): BinaryRefused =>
  new BinaryRefused({ message: `Victoria.Binary ${path}: ${message}` });

/** Re-say a download or archive failure as this resource's, keeping its tag. */
const restated = (path: string, cause: unknown): unknown => {
  const say = (message: string) => `Victoria.Binary ${path}: ${message}. ${NOTHING}`;
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

export type Desired = { readonly want: FileTarget; readonly release: ResolvedRelease };

/** Validate against the catalog, then resolve owner and group through the runner. */
export const desiredBinary = async (
  runner: HostRunner,
  props: VictoriaBinaryProps,
  catalog: VictoriaCatalog = VICTORIA_CATALOG,
): Promise<Desired> => {
  const path = victoriaBinaryPath(props);
  const problems = binaryProblems(props, catalog);
  if (problems.length > 0) throw refuse(path, `${problems.join('; ')}. ${NOTHING}`);
  const release = resolveVictoriaRelease(props, catalog);
  const ids = await resolveIds(runner, props, path, refuse);
  const mode = props.mode ?? DEFAULT_BINARY_MODE;
  return { release, want: { mode, path, sha256: release.memberSha256, ...ids } };
};

const withSource = (
  found: HostFileAttributes,
  release: ResolvedRelease,
): VictoriaBinaryAttributes => ({ ...found, member: release.member, url: release.url });

/** The file at the declaration's path, described as this release, or undefined when absent. */
export const readBinary = async (
  runner: HostRunner,
  props: VictoriaBinaryProps,
  catalog: VictoriaCatalog = VICTORIA_CATALOG,
): Promise<VictoriaBinaryAttributes | undefined> => {
  const { release, want } = await desiredBinary(runner, props, catalog);
  const found = await readFileAttributes(runner, want.path);
  return found === undefined ? undefined : withSource(found, release);
};

/** An owned binary as it is now, at the path state recorded — no catalog needed to find it. */
export const refreshBinary = async (
  runner: HostRunner,
  output: VictoriaBinaryAttributes,
): Promise<VictoriaBinaryAttributes | undefined> => {
  const found = await readFileAttributes(runner, output.path);
  return found === undefined ? undefined : { ...found, member: output.member, url: output.url };
};

export const diffBinary = async (
  runner: HostRunner,
  news: VictoriaBinaryProps,
  output: VictoriaBinaryAttributes,
  catalog: VictoriaCatalog = VICTORIA_CATALOG,
): Promise<Diff> => diffTarget(runner, (await desiredBinary(runner, news, catalog)).want, output);

/**
 * ⛔ THE DIRECTORY IS DECLARED, NEVER INVENTED. Checked before any download: a missing directory
 *   would otherwise cost 123 MB and then fail at the write. A symlink is refused as well — the
 *   write would land wherever it points, under an owner nobody declared.
 */
const directoryReady = async (runner: HostRunner, props: VictoriaBinaryProps): Promise<void> => {
  const stat = await runner.stat(props.directory);
  if (stat?.kind === 'directory') return;
  const why = stat === undefined ? 'does not exist' : `is a ${stat.kind}, not a directory`;
  throw refuse(
    victoriaBinaryPath(props),
    `directory ${props.directory} ${why}; declare it (HostDirectory) and pass its path. ${NOTHING}`,
  );
};

export type ReconcileOptions = {
  /** The attributes state holds; undefined on a create. */
  readonly output?: VictoriaBinaryAttributes | undefined;
  /** adoptsAtApply's answer. What it may take over is convergeFile's ⛔. @default false */
  readonly adopt?: boolean;
  /** Progress for the deploy log — the engine's `session.note`. */
  readonly note?: (message: string) => Promise<void>;
  readonly catalog?: VictoriaCatalog;
};

/** Install the declared binary unless it is already there, and return it as read back. */
export const reconcileBinary = async (
  runner: HostRunner,
  fetch: FetchArchive,
  props: VictoriaBinaryProps,
  options: ReconcileOptions = {},
): Promise<VictoriaBinaryAttributes> => {
  const { adopt = false, catalog = VICTORIA_CATALOG, note = async () => undefined } = options;
  const { release, want } = await desiredBinary(runner, props, catalog);
  await directoryReady(runner, props);
  const bytesFor = async (before: HostFileAttributes | undefined): Promise<Uint8Array> => {
    // ★ The right bytes with the wrong mode or owner: re-write what is there, re-hashed, rather
    //   than download 123 MB to get the same bytes back.
    if (before?.sha256 === want.sha256) {
      const local = await runner.readFile(want.path);
      if (local !== undefined && sha256Hex(local) === want.sha256) return local;
    }
    await note(`downloading ${release.url} (${String(release.size)} bytes)`);
    try {
      const bytes = await verifiedMember(await fetch(release.url, release.size), release);
      await note(`verified ${release.member} ${release.memberSha256}`);
      return bytes;
    } catch (cause) {
      throw restated(want.path, cause);
    }
  };
  const spec = { bytesFor, owner: props.owner, refuse, want };
  return withSource(await convergeFile(runner, spec, options.output, adopt), release);
};

/** Remove the binary. Idempotent. ⛔ Refuses a path that has since become a symlink or directory. */
export const deleteBinary = (runner: HostRunner, output: VictoriaBinaryAttributes): Promise<void> =>
  removeWholeFile(runner, output, refuse);
