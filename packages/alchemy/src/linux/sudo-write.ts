/**
 * sshSudoRunner's `writeFileAtomic`, split out of sudo-runner.ts so that file stays the wiring.
 *
 * ⛔ WHY NOT `install` STRAIGHT TO `path`, THE WAY THE MAC RUNNER DOES. GNU `install` opens the
 *   destination and writes THROUGH it (ssh-scripts.ts's header); there is no macOS-style stage-
 *   and-rename built in. So this stages the bytes, `install`s them into a FRESH temp file in the
 *   destination's own directory (fresh, so "writes through" changes nothing that mattered), then
 *   `mv`s that temp file onto `path` — rename(2), same directory, so the swap is atomic and never
 *   torn, exactly what `ssh-scripts.ts writeScript` already does for the unprivileged case.
 * ⛔ `install` NEVER TAKES `-o`/`-g` — see sudo-allowlist-chown.ts's header (coreutils' own
 *   `get_ids()` has no way to force numeric ids, unlike `chown`). It always installs owned by
 *   whoever `sudo` runs it as; a non-root owner or group is set afterward by a separate,
 *   `+`-forced `chown` on that same temp file, before `mv`.
 * ⛔ THE DERIVED TEMP IS VERIFIED ABSENT, AS THE OPERATOR, BEFORE `install` RUNS. A 12-hex-char
 *   collision is astronomically unlikely, but "unlikely" is not the bar a privileged write is held
 *   to elsewhere in this runner, and the check costs one `stat` this runner already knows how to do.
 * ⛔ ON ANY FAILURE AFTER `install` SUCCEEDS, THE TEMP IS REMOVED (also as root, since only root
 *   can now touch it). A left-behind `.foo.hf-xxxx.tmp` would read, on the next plan, as an extra
 *   file under the prefix that guard would find and no code would explain — and if THAT cleanup
 *   itself fails, the thrown error says so and names the path, rather than silently swallowing it.
 */
import { randomBytes } from 'node:crypto';
import type { ExecResult, HostRunner, WriteOptions } from '../launchd/runner.ts';
import { CHOWN, INSTALL, MV, RM, SudoRefusedError, octalMode, prefixOf } from './sudo-allowlist.ts';
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

/**
 * The cleanup `rm`'s own failure, for the merged error below. 🔴 MEASURED (adversarial review,
 *   round 3, 2026-09-23): a plain `ExecResult` (the shape `elevate()` resolves with for a command
 *   that RAN but exited non-zero) has no useful `toString()` — `String(cleaned)` printed
 *   `[object Object]`, silently dropping the one thing an operator doing manual cleanup needs:
 *   what `rm` actually said. A thrown `Error` (a refused or transport-failed `rm`) still prints
 *   its own message correctly, so only the `ExecResult` shape needed a name.
 */
const describeCleanupFailure = (cleaned: unknown): string => {
  if (
    typeof cleaned === 'object' &&
    cleaned !== null &&
    'exitCode' in cleaned &&
    'stderr' in cleaned
  ) {
    const result = cleaned as ExecResult;
    return `exit ${String(result.exitCode)}: ${result.stderr.trim().slice(0, 300)}`;
  }
  return cleaned instanceof Error ? cleaned.message : String(cleaned);
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

/** `+<uid>`, `:+<gid>`, or `+<uid>:+<gid>` — omitted sides leave that half of ownership alone. */
const safeOwnerSpec = (uid: number | undefined, gid: number | undefined): string =>
  `${uid === undefined ? '' : `+${uid}`}${gid === undefined ? '' : `:+${gid}`}`;

/**
 * A non-root owner or group, when one was declared: `install` leaves the temp root:root (see the
 * file header), so this is the ONLY call that can hand it to someone else. `undefined` from either
 * side when that half already matches `install`'s own default (0/omitted), so a plain root-owned
 * write costs nothing extra here.
 */
const chownNeeded = (
  options: WriteOptions,
): { readonly uid?: number; readonly gid?: number } | undefined => {
  const uid = options.uid !== undefined && options.uid !== 0 ? options.uid : undefined;
  const gid = options.gid !== undefined && options.gid !== 0 ? options.gid : undefined;
  return uid === undefined && gid === undefined
    ? undefined
    : { ...(uid === undefined ? {} : { uid }), ...(gid === undefined ? {} : { gid }) };
};

/**
 * Stage, `install` into a fresh temp file beside `path`, `chown` it if a non-root owner was
 * declared, `mv` it into place. Cleans up the temp on a failed `mv`, and always disposes the
 * stage — whether or not the write succeeded.
 */
export const writeUnderPrefix = async (
  base: HostRunner,
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
    const installArgv = [INSTALL, '-m', mode, '-T', '--', staged.path, temp];
    const before = async () => {
      const existing = await base.stat(temp);
      if (existing !== undefined) {
        throw new SudoRefusedError(
          `sshSudoRunner ${temp}: already exists (a ${existing.kind}); refusing to install over ` +
            'it. Nothing ran as root.',
        );
      }
    };
    mustSucceed(await elevate(installArgv, { staged: staged.path, temp }, before), installArgv);
    try {
      const owner = chownNeeded(options);
      if (owner !== undefined) {
        const chownArgv = [CHOWN, safeOwnerSpec(owner.uid, owner.gid), '--', temp];
        mustSucceed(await elevate(chownArgv, { temp }), chownArgv);
      }
      const mvArgv = [MV, '-f', '-T', '--', temp, path];
      mustSucceed(await elevate(mvArgv, { temp }), mvArgv);
    } catch (cause) {
      const rmArgv = [RM, '-f', '--', temp];
      const cleaned = await elevate(rmArgv, { temp })
        .then((result) => (result.exitCode === 0 ? undefined : result))
        .catch((rmCause: unknown) => rmCause);
      if (cleaned !== undefined) {
        throw new Error(
          `${cause instanceof Error ? cause.message : String(cause)} — AND removing the leftover ` +
            `temp ${temp} also failed (${describeCleanupFailure(cleaned)}); it needs manual ` +
            'cleanup as root.',
          { cause },
        );
      }
      throw cause;
    }
  } finally {
    await staged.dispose();
  }
};
