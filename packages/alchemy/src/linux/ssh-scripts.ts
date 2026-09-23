/**
 * The four remote scripts a HostRunner needs, and the parser for the one that returns data.
 * Pure: every shape here is asserted in ssh-scripts.test.ts without a connection.
 *
 * ★ MEASURED 2026-09-22 on Debian 13 (systemd 257, kernel 7.0.14-pve), read-only over ssh:
 *     $ stat -c '%f %a %u %g %s' /etc/hostname   →  81a4 644 0 0 4          (exit 0)
 *     $ stat -c '%f %a %u %g %s' /nonexistent    →  "cannot statx"          (exit 1)
 *   `%f` is the RAW mode in hex, so the file type is in it (0x8000 regular, 0x4000 directory,
 *   0xa000 symlink) and `%a` is the permission bits alone. ⛔ GNU `stat` does NOT follow symlinks
 *   without `-L`, which is what makes this an lstat — the FileStat contract (runner.ts) requires it,
 *   because writing through a symlink changes a file the resource never named.
 * ⚠️ COREUTILS, NOT POSIX. `stat -c`, `base64` and `mv -f` are GNU/BusyBox spellings, not POSIX
 *   ones; this runner is for Linux hosts and refuses anything else at the probe (ssh-runner.ts).
 */
import { ABSENT, quoteArgv, shellQuote } from './ssh-command.ts';
import type { FileStat, WriteOptions } from '../launchd/runner.ts';

/** ★ `-e` is false for a dangling symlink and `-L` is true for it, so both tests together mean
 *    "something is at this path" — the question stat(2) answers and `-e` alone does not. */
const IF_PRESENT = (path: string) => `if [ -e ${path} ] || [ -L ${path} ]; then`;

export const statScript = (path: string): string => {
  const quoted = shellQuote(path);
  return `${IF_PRESENT(quoted)} stat -c '%f %a %u %g %s' -- ${quoted}; else exit ${String(ABSENT)}; fi`;
};

/** ★ base64 on the wire: stdout then carries no byte that a shell, a pty or a locale can alter. */
export const readScript = (path: string): string => {
  const quoted = shellQuote(path);
  return `${IF_PRESENT(quoted)} base64 -- ${quoted}; else exit ${String(ABSENT)}; fi`;
};

/** ⛔ `rm -f` is idempotent for an absent path and still FAILS for a directory, which is what keeps
 *    HostRunner.removeFile from quietly removing something that is not a file. */
export const removeScript = (path: string): string => `rm -f -- ${shellQuote(path)}`;

export const execScript = (argv: readonly string[]): string => quoteArgv(argv);

/**
 * Write bytes (fed on stdin) so `path` holds the old file or the new one and never a torn mix.
 *
 * ⛔ NOT `install`. GNU coreutils `install` opens the destination and writes THROUGH it — unlike
 *   macOS's, which stages and renames — so a deploy interrupted mid-write would leave a truncated
 *   config where a whole one used to be. Staging beside the target and `mv` (rename(2), same
 *   directory so never EXDEV) is the only atomic spelling available over a shell.
 * ⛔ `set -C` and `umask 077`: the staged file is created O_EXCL, so a symlink or a file planted at
 *   the temp name is a refusal rather than a write through it, and it is unreadable by anyone else
 *   in the moment before its mode is set.
 * ⚠️ chown BEFORE chmod: chown by root clears setuid/setgid, so the other order silently drops a
 *   declared 4755 — the same ordering localRunner keeps for the same reason.
 * ⚠️ Each step removes the staged file before it fails, so a failed write leaves no litter beside
 *   a file someone else owns.
 */
export const writeScript = (path: string, temp: string, options: WriteOptions): string => {
  const target = shellQuote(path);
  const staged = shellQuote(temp);
  const bail = `{ rm -f -- ${staged}; exit`;
  /**
   * ⛔ NEVER `chown <uid>:` — GNU chown reads a trailing colon as "and that user's LOGIN GROUP",
   *   which is a gid nobody declared. Each half is spelled only when it was asked for.
   */
  const owner =
    options.uid === undefined
      ? options.gid === undefined
        ? undefined
        : `:${String(options.gid)}`
      : options.gid === undefined
        ? String(options.uid)
        : `${String(options.uid)}:${String(options.gid)}`;
  const chown = owner === undefined ? [] : [`chown ${owner} -- ${staged} || ${bail} 72; }`];
  return [
    'set -C',
    'umask 077',
    `cat > ${staged} || ${bail} 71; }`,
    ...chown,
    `chmod ${options.mode.toString(8).padStart(3, '0')} -- ${staged} || ${bail} 73; }`,
    `mv -f -- ${staged} ${target} || ${bail} 74; }`,
  ].join('\n');
};

const TYPE_BITS = 0xf000;
const KINDS = new Map<number, FileStat['kind']>([
  [0x8000, 'file'],
  [0x4000, 'directory'],
  [0xa000, 'symlink'],
]);

/** `stat -c '%f %a %u %g %s'` output → a FileStat, or `undefined` when it is not that shape. */
export const parseStat = (stdout: string): FileStat | undefined => {
  const fields = stdout.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [rawMode, perms, uid, gid, size] = fields as [string, string, string, string, string];
  const raw = Number.parseInt(rawMode, 16);
  const mode = Number.parseInt(perms, 8);
  const numbers = [raw, mode, Number(uid), Number(gid), Number(size)];
  if (numbers.some((value) => !Number.isSafeInteger(value) || value < 0)) return undefined;
  return {
    gid: Number(gid),
    kind: KINDS.get(raw & TYPE_BITS) ?? 'other',
    // ⚠️ `%a` alone, never `%f & 0o7777`: they agree, and the permission field is the documented one.
    mode,
    size: Number(size),
    uid: Number(uid),
  };
};
