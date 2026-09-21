/**
 * The checks sudo-runner.ts makes against the host, as the deploying user, before it runs anything
 * as root. sudo-allowlist.ts checks the argv; this checks what the paths in it actually are.
 *
 * ⛔ WHAT IS LOGGED IS WHAT IS WRITTEN. A symlinked directory under a prefix would make
 *   `install` or `rm`, running as root, act on a path the log never named. So every directory
 *   between the prefix and the file must be a real directory.
 * ⚠️ These checks run before the privileged call, so they guard against a mistaken declaration, not
 *   against someone who can already write inside a prefix and swap a path in between. Declare only
 *   directories that root owns.
 */
import type { HostRunner, WriteOptions } from './runner.ts';

const refuse = (path: string, message: string): Error =>
  new Error(`sudoRunner ${path}: ${message}`);

/** The directories strictly between `prefix` and the file at `path`. */
export const betweenDirs = (prefix: string, path: string): string[] => {
  const parts = path
    .slice(prefix.length + 1)
    .split('/')
    .slice(0, -1);
  return parts.map((_, index) => `${prefix}/${parts.slice(0, index + 1).join('/')}`);
};

/**
 * What must be at `path` itself: a regular file, or (for a write or a remove) nothing yet.
 * ⚠️ A DIRECTORY AT THE DESTINATION IS THE TRAP: `install src dir` copies INTO the directory
 *   (install(1)), and install decides that with stat, so a symlink to a directory does the same.
 */
export type Expect = 'file' | 'file-or-absent';

/** Refuse a symlink or a non-directory between the prefix and `path`, and anything but a file at it. */
export const assertPlainPath = async (
  base: HostRunner,
  prefix: string,
  path: string,
  expect: Expect,
): Promise<'file' | 'absent'> => {
  const dirs = betweenDirs(prefix, path);
  const stats = await Promise.all(dirs.map((dir) => base.stat(dir)));
  for (const [index, stat] of stats.entries()) {
    if (stat?.kind !== 'directory') {
      throw refuse(
        path,
        `${String(dirs[index])} is ${stat === undefined ? 'missing' : `a ${stat.kind}`}; root ` +
          'writes only through real directories under a declared prefix.',
      );
    }
  }
  const target = await base.stat(path);
  if (target === undefined && expect === 'file-or-absent') return 'absent';
  if (target?.kind === 'file') return 'file';
  throw refuse(path, `is ${target === undefined ? 'missing' : `a ${target.kind}`}, not a file`);
};

/**
 * POSIX read permission for one uid: owner class, else group class, else other. `undefined` when
 * only group membership could decide and the groups are unknown.
 * ⚠️ EXACTLY ONE CLASS APPLIES. A group member gets the group bits even when the other bits are
 *   wider (`0604` hides a file from its group), so "other can read" is not enough on its own.
 */
export const canRead = (
  file: { readonly uid: number; readonly gid: number; readonly mode: number },
  uid: number,
  groups: readonly number[] | undefined,
): boolean | undefined => {
  if (uid === 0) return true;
  if (file.uid === uid) return (file.mode & 0o400) !== 0;
  const groupRead = (file.mode & 0o040) !== 0;
  const otherRead = (file.mode & 0o004) !== 0;
  // Membership cannot change the answer when both classes agree.
  if (groupRead === otherRead) return groupRead;
  if (groups === undefined) return undefined;
  return groups.includes(file.gid) ? groupRead : otherRead;
};

/**
 * ⛔ REFUSE A FILE THE DEPLOYING USER COULD NOT READ BACK, before writing it. Both providers read
 *   every write back to verify it (host-file-lifecycle.ts, job-lifecycle.ts) and read it again at
 *   every plan, as the deploying user; this runner elevates writes, never reads. A root-only
 *   `0600` would be installed, then fail the read-back with EACCES and stay on disk with no state,
 *   so every later plan would fail too.
 * ★ An omitted owner is root (under a prefix the runner writes as root). An omitted group is the
 *   parent directory's, which is the group a new file gets on macOS.
 * ⚠️ Unknown groups never refuse: the read-back after the write stays the final judge.
 */
export const assertReadableBack = async (
  base: HostRunner,
  path: string,
  options: WriteOptions,
  groups: readonly number[] | undefined,
): Promise<void> => {
  const operator = base.effectiveUid();
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  const gid = options.gid ?? (await base.stat(parent))?.gid ?? 0;
  const file = { gid, mode: options.mode, uid: options.uid ?? 0 };
  if (canRead(file, operator, groups) !== false) return;
  throw refuse(
    path,
    `owner ${String(file.uid)}, group ${String(gid)}, mode ${file.mode.toString(8)} would hide it ` +
      `from the deploying user (uid ${String(operator)}), who reads every file back. Declare a ` +
      'mode that user can read, or deploy as root. Nothing was written.',
  );
};

/**
 * The deploying user's groups, from `id -G`; `undefined` when that fails.
 * ⚠️ NOT process.getgroups(). MEASURED 2026-09-21 on macOS 27.2: getgroups() returned 16 groups
 *   where `id -G` returned 18, because macOS caps a process's own list at 16. A group past the
 *   16th would read as "not a member" and refuse a file the user can in fact read.
 */
export const operatorGroups = async (base: HostRunner): Promise<readonly number[] | undefined> => {
  const result = await base.exec(['/usr/bin/id', '-G']);
  const ids = result.stdout.trim().split(/\s+/);
  return result.exitCode === 0 && ids.every((id) => /^\d+$/.test(id)) ? ids.map(Number) : undefined;
};
