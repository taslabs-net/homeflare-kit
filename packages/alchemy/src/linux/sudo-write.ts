/**
 * sshSudoRunner's `writeFileAtomic`, split out of sudo-runner.ts so that file stays the wiring.
 *
 * ⛔ WHY NOT `install` STRAIGHT TO `path`, THE WAY THE MAC RUNNER DOES. GNU `install` opens the
 *   destination and writes THROUGH it (ssh-scripts.ts's header); there is no macOS-style stage-
 *   and-rename built in. So this stages the bytes, `install`s them into a FRESH temp file in the
 *   destination's own directory (fresh, so "writes through" changes nothing that mattered), then
 *   `mv`s that temp file onto `path` — rename(2), same directory, so the swap is atomic and never
 *   torn, exactly what `ssh-scripts.ts writeScript` already does for the unprivileged case.
 * ⛔ ON ANY FAILURE AFTER `install` SUCCEEDS, THE TEMP IS REMOVED (also as root, since only root
 *   can now touch it). A left-behind `.foo.hf-xxxx.tmp` would read, on the next plan, as an extra
 *   file under the prefix that guard would find and no code would explain.
 */
import { randomBytes } from 'node:crypto';
import type { ExecResult, HostRunner, WriteOptions } from '../launchd/runner.ts';
import { INSTALL, MV, RM, SudoRefusedError, octalMode, prefixOf } from './sudo-allowlist.ts';
import { assertInstallable, operatorGroups } from './sudo-guard.ts';
import type { Staged } from './sudo-stage.ts';

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

/** `<dir>/.<basename>.hf-<12 hex>.tmp`, in `dest`'s own directory — never anywhere else. */
export const deriveTemp = (dest: string): string =>
  `${dirOf(dest)}/.${basename(dest)}.hf-${randomBytes(6).toString('hex')}.tmp`;

/** What one privileged call, already checked against the allowlist, comes back as when it fails. */
const mustSucceed = (result: ExecResult, argv: readonly string[]): void => {
  if (result.exitCode !== 0) {
    throw new Error(
      `sudo -n ${JSON.stringify(argv)} -> ${String(result.exitCode)}: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
};

/** A privileged call: allowlisted, logged, run. Shared with sudo-runner.ts's own exec() routing. */
export type Elevate = (
  argv: readonly string[],
  context?: { readonly staged?: string; readonly temp?: string },
  before?: () => Promise<unknown>,
) => Promise<ExecResult>;

/**
 * Plan-time and write-time share this: valid mode, the path chain, mode/owner refusals and the
 * read-back — everything a write can be refused for before anything is staged or run as root.
 * `undefined` outside every prefix, where the caller falls back to `base` directly.
 */
export const vetWrite = async (
  base: HostRunner,
  prefixes: readonly string[],
  path: string,
  options: WriteOptions,
): Promise<{ readonly mode: string; readonly prefix: string } | undefined> => {
  const prefix = prefixOf(path, prefixes);
  if (prefix === undefined) return undefined;
  const mode = octalMode(options.mode);
  if (mode === undefined)
    throw new SudoRefusedError(`sshSudoRunner ${path}: mode must be 0–0o7777`);
  const groups = await operatorGroups(base);
  await assertInstallable(base, prefix, path, options, groups);
  return { mode, prefix };
};

/**
 * Stage, `install` into a fresh temp file beside `path`, `mv` it into place. Cleans up the temp on
 * a failed `mv`, and always disposes the stage — whether or not the write succeeded.
 */
export const writeUnderPrefix = async (
  elevate: Elevate,
  stage: (bytes: Uint8Array) => Promise<Staged>,
  path: string,
  bytes: Uint8Array,
  options: WriteOptions,
  mode: string,
): Promise<void> => {
  const temp = deriveTemp(path);
  const staged = await stage(bytes);
  try {
    const installArgv = [
      INSTALL,
      '-m',
      mode,
      ...(options.uid === undefined ? [] : ['-o', String(options.uid)]),
      ...(options.gid === undefined ? [] : ['-g', String(options.gid)]),
      '-T',
      '--',
      staged.path,
      temp,
    ];
    mustSucceed(await elevate(installArgv, { staged: staged.path, temp }), installArgv);
    try {
      const mvArgv = [MV, '-f', '-T', '--', temp, path];
      mustSucceed(await elevate(mvArgv, { temp }), mvArgv);
    } catch (cause) {
      const rmArgv = [RM, '-f', '--', temp];
      await elevate(rmArgv, { temp }).catch(() => undefined);
      throw cause;
    }
  } finally {
    await staged.dispose();
  }
};
